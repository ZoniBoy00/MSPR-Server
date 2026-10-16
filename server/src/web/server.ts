import { createServer, Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { DEFAULT_PRIVACY, GATES, Pseudonyms, isAdmin } from "./privacy.js";
import type { Privacy, Section } from "./privacy.js";
import { RateLimiter } from "./ratelimit.js";
import { makeCaches, send } from "./context.js";
import type { Ctx, Handler } from "./context.js";
import type { Diagnostics } from "../ops/diagnostics.js";
import { routes as anticheat } from "./routes/anticheat.js";
import { routes as diagnostics } from "./routes/diagnostics.js";
import { routes as boards } from "./routes/boards.js";
import { horizonApi } from "./routes/horizon.js";
import { routes as people } from "./routes/people.js";
import { routes as races } from "./routes/races.js";
import { routes as system } from "./routes/system.js";

/**
 * The status site and the read-only JSON API (port 8080 by default), plus Horizon's private account API.
 *
 *   /                the status site: index.html plus the stylesheet and ES modules under /assets
 *   /api             the endpoint list; the routes live in routes/*.ts, one file per area
 *   /horizon/*       Horizon's account, stats and ban interface (loopback only)
 *
 * Live Medius data comes from Horizon's CRUD endpoint /GetMspr/ (port 61920).
 */
const API: Record<string, Handler> = { ...system, ...boards, ...races, ...people, ...anticheat, ...diagnostics };

const WEB_DIR = dirname(fileURLToPath(import.meta.url));
const PAGE_FILE = join(WEB_DIR, "index.html");
const ASSETS_DIR = join(WEB_DIR, "assets");
const ASSET_TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png" };

/** Serves a file from the assets folder; the path may not leave it. Revalidated with an ETag so a deployment shows up at once. */
function serveAsset(c: Ctx): void {
  let rel: string;
  try { rel = normalize(decodeURIComponent(c.url.pathname.slice("/assets/".length))); }
  catch { c.res.writeHead(404); c.res.end(); return; }                       // malformed %-escape
  const file = join(ASSETS_DIR, rel);
  const type = ASSET_TYPES[extname(file)];
  if (!type || rel.startsWith("..") || !file.startsWith(ASSETS_DIR + sep)) { c.res.writeHead(404); c.res.end(); return; }
  try {
    const st = statSync(file);
    const etag = `"${createHash("sha1").update(`${st.size}-${st.mtimeMs}`).digest("hex").slice(0, 16)}"`;
    if (c.req.headers["if-none-match"] === etag) { c.res.writeHead(304, { ETag: etag }); c.res.end(); return; }
    send(c.req, c.res, 200, type, readFileSync(file), { ETag: etag, "Cache-Control": "no-cache" });
  } catch {
    c.res.writeHead(404);
    c.res.end();
  }
}

/** The RPCS3 patch offered for download: next to the server in a deployed copy, or in the repository's patches folder. */
const PATCH_FILES = [join(WEB_DIR, "../../downloads/imported_patch.yml"), join(WEB_DIR, "../../../patches/rpcs3/imported_patch.yml")];

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
/** The page loads its fonts from Google Fonts and everything else from this server. */
const PAGE_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
  + "script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'";

export function startWeb(cfg: Config, store: Store, diag?: Diagnostics): Server {
  // 300 requests a minute per address (the status site makes about 9 every 10 seconds per open tab); Horizon is exempt
  const limiter = new RateLimiter(300);
  const cached = makeCaches(store);
  const priv: Privacy = { ...DEFAULT_PRIVACY, ...(cfg.web.privacy ?? {}) };
  const names = priv.pseudonymize ? new Pseudonyms(priv.salt) : null;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://web");
    const client = req.socket.remoteAddress ?? "";
    const local = LOOPBACK.has(client) && !req.headers["x-forwarded-for"];   // behind a reverse proxy every client would look local
    if (!local && !limiter.allow(client)) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "30" });
      return res.end(JSON.stringify({ error: "too many requests" }));
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const path = url.pathname;
    if (path.startsWith("/api")) res.setHeader("Access-Control-Allow-Origin", "*");   // public, read-only data

    const admin = isAdmin(req, cfg.web.adminToken);
    const mask = names && !admin ? names : null;
    if (path.startsWith("/api")) { res.setHeader("Cache-Control", "private, no-store"); res.setHeader("Vary", "Authorization, X-Admin-Token"); }
    const ctx: Ctx = {
      cfg, store, req, res, url, cached, admin, diag,
      allowed: (s: Section) => admin || (s !== "diagnostics" && priv[s as Exclude<Section, "diagnostics">] === "public"),   // the journal holds IP addresses: never public
      account: (name) => {
        if (!mask) return store.accountByName(name);
        const real = mask.resolve(name, store.accountNames());
        return real === undefined ? undefined : store.accountByName(real);
      },
      json: (body) => send(req, res, 200, "application/json", JSON.stringify(mask && path !== "/api/meta" ? mask.mask(body) : body, null, 1)),
      fail: (status, body) => send(req, res, status, "application/json", JSON.stringify(body)),
    };
    try {
      if (path.startsWith("/horizon/")) {
        if (!local) { res.writeHead(403); return res.end(); }
        return await horizonApi(ctx);
      }
      if (path.startsWith("/assets/")) return serveAsset(ctx);
      if (path === "/downloads/imported_patch.yml") {
        const file = PATCH_FILES.find((f) => existsSync(f));
        if (!file) { res.writeHead(404); return res.end(); }
        return send(req, res, 200, "text/yaml; charset=utf-8", readFileSync(file), { "Content-Disposition": 'attachment; filename="imported_patch.yml"', "Cache-Control": "no-cache" });
      }
      if (path === "/api/access") return ctx.json({ admin, anticheat: ctx.allowed("anticheat"), bans: ctx.allowed("bans"), live: ctx.allowed("live"), raceHistory: ctx.allowed("raceHistory"), diagnostics: ctx.allowed("diagnostics"),
        pseudonymized: !!mask, tokenLogin: !!cfg.web.adminToken });
      const handler = API[path];
      const gate = GATES[path] as Section | undefined;
      if (handler) {
        if (gate && !ctx.allowed(gate)) return ctx.fail(403, { error: "restricted", section: gate });
        return await handler(ctx);
      }
      if (path === "/" || path === "/index.html")
        return send(req, res, 200, "text/html; charset=utf-8", readFileSync(PAGE_FILE), { "Cache-Control": "no-cache", "Content-Security-Policy": PAGE_CSP });
      res.writeHead(404);
      res.end();
    } catch (e) {
      console.error(`[web] ${req.method} ${path} failed:`, e);
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "internal error" })); }
    }
  });
  server.listen(cfg.web.port, "0.0.0.0", () => console.log(`[web] status page on http://${cfg.lanIp}:${cfg.web.port}/`));
  return server;
}
