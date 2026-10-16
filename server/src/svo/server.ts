import { createHash, randomBytes } from "node:crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { createWriteStream, mkdirSync, renameSync, statSync, WriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { Config, readText } from "../config.js";
import { Store } from "../db/store.js";
import { banCheck, OnlineTracker, reviewStored, strike } from "../online/integrity.js";
import { Diagnostics, platformOfKey } from "../ops/diagnostics.js";
import { checkRace, SAVED_RESULT_PREFIX } from "./anticheat.js";
import { RateLimiter } from "../web/ratelimit.js";
import { checkTicket } from "./ticket.js";
import { ghostXml, hasGhost, loadGhost, saveGhost } from "./ghosts.js";
import { impossibleReport } from "./review.js";
import { announcementText, beatenXml, isPsnTicket, STATUS_OK, eulaXml, parseNpTicket, svoMac, urlListXml, xmlEscape } from "./protocol.js";

/**
 * SVO HTTP service (port 10060), byte-compatible with the original service where the game cares:
 * X-SVOMac on every response, HTTP/1.1 + Connection: close, text/xml;charset=UTF-8,
 * no Content-Length, same XML text/line endings (fixtures: server/test/fixtures/svo).
 * MUIS hands the game http://<ip>:10060/motorstormpr/index (+ "?languageID=N").
 */
export function startSvo(cfg: Config, store: Store, logFile?: string, tracker?: OnlineTracker, diag?: Diagnostics): Server {
  // one append stream for the request log (was a synchronous open/append/close per request)
  let log: WriteStream | undefined;
  if (logFile) {
    try { mkdirSync(dirname(logFile), { recursive: true }); log = createWriteStream(logFile, { flags: "a" }); }
    catch { log = undefined; }
    log?.on("error", () => { log = undefined; });
    // the request log grows with every request: keep the current file under 10 MB and one older copy
    const rotate = () => {
      try {
        if (statSync(logFile).size < 10 * 1024 * 1024) return;
        log?.end();
        renameSync(logFile, `${logFile}.1`);
        log = createWriteStream(logFile, { flags: "a" });
        log.on("error", () => { log = undefined; });
      } catch { /* keep logging to the current stream */ }
    };
    rotate();
    setInterval(rotate, 5 * 60 * 1000).unref();
  }
  const server = createServer({ keepAlive: false }, (req, res) => {
    const chunks: Buffer[] = [];
    let size = 0, tooBig = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // a public port must not buffer whatever it is sent (the largest real body is a 256 kB ghost)
        if (!tooBig) {
          tooBig = true;
          diag?.event("svo.error", `a request body over ${MAX_BODY_BYTES} bytes was refused`, { ip: req.socket.remoteAddress?.replace(/^::ffff:/, ""), url: (req.url ?? "").split("?")[0] }, "warn");
          res.writeHead(413, { Connection: "close" });
          res.end();
          req.destroy();
        }
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return;
      try {
        route(cfg, store, req, res, Buffer.concat(chunks), log, tracker, logFile ? join(dirname(logFile), "ghosts") : undefined, diag);
      } catch (e) {
        console.error("[svo] handler error", e);
        diag?.event("svo.error", `${req.method} ${(req.url ?? "").split("?")[0]} failed: ${(e as Error).message}`, { url: req.url }, "error");
        if (!res.headersSent) reply(req, res, STATUS_OK);
      }
    });
  });
  // a connection that is not valid HTTP never reaches route(): without this it vanishes without a trace
  server.on("clientError", (err: NodeJS.ErrnoException, socket: import("node:net").Socket) => {
    const raw = (err as { rawPacket?: Buffer }).rawPacket;
    diag?.event("svo.error", `a client sent something that is not HTTP: ${err.code ?? err.message}`,
      { ip: socket.remoteAddress?.replace(/^::ffff:/, ""), code: err.code, firstBytes: raw ? raw.subarray(0, 48).toString("hex") : undefined }, "warn");
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  server.listen(cfg.svo.port, "0.0.0.0", () => console.log(`[svo] listening on :${cfg.svo.port}`));
  return server;
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Largest request body accepted (a Time Attack ghost is at most 256 kB). */
const MAX_BODY_BYTES = 512 * 1024;
const SESSION_TTL_MS = 24 * 3600 * 1000;
const MAX_SESSIONS = 5000;

type Acct = { id: number; name: string };
/** SVO sessions: the login sets one cookie (AuthKeyTime, like the original service) whose value identifies the account. */
const sessions = new Map<string, Acct & { t: number }>();
/** Logins per address and minute: a console logs in once per game session. */
const loginLimiter = new RateLimiter(60);

/** Forgets old sessions (and the per-address fallback) so the maps cannot grow without bound. */
function pruneSessions(now = Date.now()): void {
  if (sessions.size <= MAX_SESSIONS / 2 && lastLoginByIp.size <= MAX_SESSIONS / 2) return;
  for (const [k, v] of sessions) if (now - v.t > SESSION_TTL_MS || sessions.size > MAX_SESSIONS) sessions.delete(k);
  while (lastLoginByIp.size > MAX_SESSIONS) lastLoginByIp.delete(lastLoginByIp.keys().next().value as string);
}

/** An online id as the networks allow it (letters, digits, - and _, at most 16). Anything else is cut out, so a name can never carry "@PSN" or control characters. */
export function cleanOnlineId(raw: string | undefined): string {
  const id = (raw ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
  return id.length >= 3 ? id : "";
}
/** When each account last logged in to SVO: results that arrive within QUEUED_WINDOW_MS of it are the game's saved backlog. */
const loginAt = new Map<number, number>();
const QUEUED_WINDOW_MS = 30_000;
/** Reasons that only mean "not in a game on this server right now": for a saved result they are no strike. */
const SAVED_RESULT_REASONS = /^(custom|ranked|casual) race reported but|^placing \d+ in a game|^race time /;

/** Fallback when the game sends no (known) cookie, e.g. after a server restart: last login from that address. */
const lastLoginByIp = new Map<string, Acct>();

function account(req: IncomingMessage): Acct {
  const c = cookies(req);
  // The original service captures name the account in plain cookies. Honoured for the replay tests only, never on a live
  // server: anybody could otherwise post races or accept the EULA as any account.
  if (c.AcctID && process.env.MSPR_TRUST_ACCT_COOKIE === "1") {
    let name = "";
    try { name = decodeURIComponent(c.AcctName ?? ""); } catch { /* keep empty */ }
    return { id: Number(c.AcctID) || 0, name };
  }
  const s = c.AuthKeyTime ? sessions.get(c.AuthKeyTime) : undefined;
  return (s ? { id: s.id, name: s.name } : undefined) ?? lastLoginByIp.get(req.socket.remoteAddress ?? "") ?? { id: 0, name: "" };
}

function reply(req: IncomingMessage, res: ServerResponse, body: string, extra: Record<string, string> = {}): void {
  const headers: Record<string, string> = {
    Connection: "close",
    "Content-Type": "text/xml;charset=UTF-8",
    Date: new Date().toUTCString(),
    ...extra,
  };
  const mac = svoMac(req.headers["x-svomac"] as string | undefined);
  if (mac) headers["X-SVOMac"] = mac;
  res.useChunkedEncodingByDefault = false; // body ends at close, like the original service
  res.sendDate = false;
  res.writeHead(200, "OK", headers);
  res.end(body);
}

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

function route(cfg: Config, store: Store, req: IncomingMessage, res: ServerResponse, body: Buffer, log?: WriteStream,
  tracker?: OnlineTracker, ghostDir?: string, diag?: Diagnostics) {
  const url = new URL(req.url ?? "/", "http://svo");
  let path = url.pathname;
  for (const prefix of ["/motorstormpr/", "/MOTORSTORM2PS3_SVML/", "/MOTORSTORM2PS3_XML/"]) {
    if (path.startsWith(prefix)) { path = path.slice(prefix.length); break; }
  }
  path = path.replace(/^\//, "");
  const p: Record<string, string> = Object.fromEntries(url.searchParams);
  if ((req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded"))
    Object.assign(p, Object.fromEntries(new URLSearchParams(body.toString("utf8"))));
  const acct = account(req);
  const line = `${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url} acct=${acct.id}/${acct.name}`;
  console.log("[svo] " + line);
  // the request log line is written when the answer is done: it carries the status, the time taken and the client's User-Agent
  const started = Date.now();
  const ua = String(req.headers["user-agent"] ?? "-").slice(0, 80);
  // the game says what it runs on in every request ("SVO-Platform: PS3" in the captures of a real PS3)
  const svoPlatform = String(req.headers["svo-platform"] ?? "-").slice(0, 20);
  res.on("close", () => log?.write(`${line} -> ${res.statusCode}${res.writableFinished ? "" : " ABORTED"} ${Date.now() - started}ms in=${body.length}B platform=${svoPlatform} ua=${ua}\n`));

  if (path === "index" || path === "index.jsp" || path === "") return reply(req, res, urlListXml());

  if (path.endsWith("ticket/login") || path.endsWith("SP_Login.jsp")) {
    const t = parseNpTicket(body);
    // same account keys as the Medius side: RPCN users by name, PSN (real PS3) users by "name@PSN"
    if (!loginLimiter.allow(req.socket.remoteAddress ?? "")) {
      res.writeHead(429, { Connection: "close", "Retry-After": "60" });
      return res.end();
    }
    const onlineId = cleanOnlineId(t.onlineId) || cleanOnlineId(acct.name.replace(/@PSN$/i, "")) || "Player";
    // Signature check of the ticket. Log only by default: the answer is in the login event (ticket.valid), and it can be
    // compared with Horizon's verdict on real tickets before `svo.requireSignedTickets` is switched on.
    const ticketCheck = checkTicket(body);
    if (cfg.svo.requireSignedTickets && ticketCheck.valid === false) {
      diag?.event("login", `SVO login refused: the ticket signature of ${onlineId} is wrong (${ticketCheck.reason})`, { account: onlineId, ticket: ticketCheck, ip: req.socket.remoteAddress?.replace(/^::ffff:/, "") }, "warn");
      res.writeHead(403, { Connection: "close" });
      return res.end();
    }
    const a = store.login(isPsnTicket(t) ? `${onlineId}@PSN` : onlineId, t.userId);
    console.log(`[svo] login ${a.online_id} -> accountID ${a.account_id}`);
    diag?.event("login", `${a.online_id.replace(/@PSN$/, "")} logged in to SVO (${platformOfKey(a.online_id)})`,
      { account: a.online_id, accountId: a.account_id, platform: platformOfKey(a.online_id), svoPlatform, ip: req.socket.remoteAddress?.replace(/^::ffff:/, ""), country: p.country, userAgent: ua, ticket: ticketCheck },
      ticketCheck.valid === false ? "warn" : "info");
    const stamp = encodeURIComponent(new Date().toISOString().slice(0, 19).replace("T", " ")) + "." + randomBytes(6).toString("hex");
    const who = { id: a.account_id, name: a.online_id };
    pruneSessions();
    sessions.set(stamp, { ...who, t: Date.now() });
    loginAt.set(a.account_id, Date.now());
    lastLoginByIp.set(req.socket.remoteAddress ?? "", who);
    return reply(req, res,
      `<XML>\n    <SP_Login>\n        <status>\n            <id>20600</id>\n        </status>\n` +
      `            <accountID>${a.account_id}</accountID>\n        <userContext>${xmlEscape(p.userContext ?? "0")}</userContext>\n` +
      `    </SP_Login>\n</XML>\n`, { "Set-Cookie": `AuthKeyTime=${stamp}; path=/` });
  }

  if (path === "getRegion")
    return reply(req, res, `<XML>\n    <region id="${cfg.svo.region.id}" mediuslocation="${cfg.svo.region.mediusLocation}"/>\n</XML>`);

  if (path === "getEula") {
    const text = readText(cfg.svo.eulaFile);
    const a = store.account(acct.id);
    const accepted = !cfg.svo.eulaAlwaysShow && !!a && a.eula_hash === sha(text);
    return reply(req, res, eulaXml(text, accepted));
  }
  if (path === "acceptEula") {
    if (acct.id) store.setEulaAccepted(acct.id, sha(readText(cfg.svo.eulaFile)));
    return reply(req, res, STATUS_OK);
  }
  if (path === "getAnnouncement")
    return reply(req, res, `<XML>\r\n    <AnnouncementTxt>\r\n        <msg>${xmlEscape(announcementText(readText(cfg.svo.announcementFile)))}</msg>\r\n    </AnnouncementTxt>\r\n</XML>\r\n`);

  // Time Attack ghost download (the game asks for the ghost of the row it picked)
  if (path === "ghost" || path === "leaderboard/ghost") {   // the real game asks for leaderboard/ghost (seen in the request log)
    const num = (k: string) => /^\d+$/.test(p[k] ?? "");
    const mine = ghostDir && num("account") && num("location.track") && num("location.vehicle")
      ? loadGhost(ghostDir, Number(p.account), p["location.track"], p["location.vehicle"]) : null;
    return reply(req, res, ghostXml(mine));
  }

  if (path.startsWith("leaderboard")) {
    const kind = path.split("/")[1] ?? "timeattack";
    let rows: ReturnType<Store["board"]> = [];
    if (kind === "timeattack" && p["location.track"] !== undefined) {
      rows = store.board(p["location.track"], p["location.vehicle"] ?? "0", cfg.leaderboards.timeattackModes, p.friends === "true" ? [acct.id] : undefined);
    }
    if (kind === "speed" && p["location.track"] !== undefined) {
      // Speed / Volcano Weekend: the game asks for stat.timeRemaining and stat.vehicle; rows carry those, most time left first
      const board = store.speedBoard(p["location.track"], p["location.vehicle"] ?? "0", p.friends === "true" ? [acct.id] : undefined);
      const first = Number(p.row ?? 0) || 0, count = Number(p.pageSize ?? 10) || 10;
      const lines = board.slice(first, first + count).map((e) =>
        `                <user accountName="${xmlEscape(e.accountName)}" accountId="${e.accountId}" timeRemaining="${e.timeRemaining}" rank="${e.rank}" ` +
        `vehicle="${xmlEscape(String(e.vehicle))}" currentPlayer="${e.accountId === acct.id ? 1 : 0}" estimated="0"/>\r\n`).join("");
      return reply(req, res,
        `<XML>\r\n    <leaderboard>\r\n        <stats>\r\n            <userStats>\r\n${lines}            </userStats>\r\n` +
        `        </stats>\r\n    </leaderboard>\r\n</XML>\r\n`);
    }
    if (kind === "ranked") {
      // ranked board = per-player sums of the stats the game asks for (stat.score, stat.playersBeaten), from finishGame
      const wanted = Object.keys(p).filter((k) => k.startsWith("stat.")).map((k) => k.slice(5));
      const ranked = store.rankedBoard(wanted);
      const first = Number(p.row ?? 0) || 0;
      const count = Number(p.pageSize ?? 10) || 10;
      const lines = ranked.slice(first, first + count).map((e) => {
        const attrs = wanted.filter((k) => /^[A-Za-z]{1,32}$/.test(k)).map((k) => ` ${k}="${e.stats[k] ?? 0}"`).join("");
        return `                <user accountName="${xmlEscape(e.accountName)}" accountId="${e.accountId}" rank="${e.rank}" ` +
          `currentPlayer="${e.accountId === acct.id ? 1 : 0}"${attrs}/>\r\n`;
      }).join("");
      return reply(req, res,
        `<XML>\r\n    <leaderboard>\r\n        <stats>\r\n            <userStats>\r\n${lines}            </userStats>\r\n` +
        `        </stats>\r\n    </leaderboard>\r\n</XML>\r\n`);
    }
    const start = Number(p.row ?? 0) || 0;
    const size = Number(p.pageSize ?? 10) || 10;
    const users = rows.slice(start, start + size).map((e) =>
      `                <user accountName="${xmlEscape(e.accountName)}" accountId="${e.accountId}" bestTime="${e.bestTime}" rank="${e.rank}" ` +
      `vehicle="${xmlEscape(String(e.vehicle))}" currentPlayer="${e.accountId === acct.id ? 1 : 0}" ghostAvailable="${hasGhost(ghostDir, e.accountId, p["location.track"] ?? "", String(e.vehicle)) ? 1 : 0}" estimated="0"/>\r\n`).join("");
    return reply(req, res,
      `<XML>\r\n    <leaderboard>\r\n        <stats>\r\n            <userStats>\r\n${users}            </userStats>\r\n` +
      `        </stats>\r\n    </leaderboard>\r\n</XML>\r\n`);
  }

  if (path.startsWith("speed-weekend/")) {
    // not implemented (the content of a Speed Weekend is unknown): answer like the original service's captured idle answer, but keep what the game sent
    console.log(`[svo] speed-weekend ${req.method} ${req.url} cookie=${req.headers.cookie ?? ""} body=${body.toString("utf8").slice(0, 2000)}`);
    const digits = (k: string) => /^\d{1,5}$/.test(p[k] ?? "");
    if (path === "speed-weekend/viewed" && acct.id && digits("location.track") && digits("location.vehicle"))
      store.weekendViewed(acct.id, p["location.track"], p["location.vehicle"]);
    if (path === "speed-weekend/beaten" && acct.id) {
      // shape decoded from the game's parser (0x2c99b8); an empty list keeps the original service's captured idle answer
      const beaten = store.weekendBeaten(acct.id);
      if (beaten.length) {
        diag?.event("weekend.beaten", `${acct.name.replace(/@PSN$/, "")} is told about ${beaten.length} beaten Weekend time(s)`, { account: acct.name, beaten }, "info");
        return reply(req, res, beatenXml(beaten));
      }
    }
    return reply(req, res, STATUS_OK);
  }

  if (path === "finishGame" || path === "game/finish" || path === "game/Game_Finish") {
    // the ids end up in XML attributes and SQL filters: only digits are real values (the game sends numbers)
    const bad = ["location.gameMode", "location.track", "location.vehicle"].find((k) => p[k] !== undefined && !/^\d{1,5}$/.test(p[k]));
    if (bad) {
      diag?.event("svo.error", `a result with a malformed ${bad} was dropped`, { account: acct.name, value: String(p[bad]).slice(0, 40) }, "warn");
      return reply(req, res, STATUS_OK);
    }
    {
      // how the player was recognised: for a real PS3 whose result does not show up this tells whether the request arrived at all and with what
      const ck = cookies(req), ip = req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "";
      const how = ck.AuthKeyTime && sessions.has(ck.AuthKeyTime) ? "session cookie" : lastLoginByIp.has(req.socket.remoteAddress ?? "") ? "last login of the address" : "nobody";
      diag?.event("result.received", `finishGame from ${acct.name || "an unknown player"}: mode ${p["location.gameMode"]}, recognised by: ${how}`,
        { account: acct.name, mode: p["location.gameMode"], track: p["location.track"], endState: p.endState, cookies: Object.keys(ck), recognisedBy: how, ip, sinceLoginMs: acct.id ? Date.now() - (loginAt.get(acct.id) ?? 0) : null }, "info");
    }
    let flagged: string | null = null;
    if (acct.id) {
      const ban = banCheck(store, cfg, acct.name, req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? null);
      // The game keeps the results it could not send and posts them right after the next SVO login (a real PS3 did this
      // with races played before this server existed). Those cannot be matched to a game the player is in now and arrive
      // as a burst. They stay off the boards when they do not fit a current game, but are marked "saved result" and are
      // not a strike, and the per-minute limit does not apply to them.
      const queued = Date.now() - (loginAt.get(acct.id) ?? 0) < QUEUED_WINDOW_MS;
      flagged = ban.banned ? `banned account (${ban.reason})`
        : checkRace(p, queued ? 0 : store.recentRaceCount(acct.id), cfg.antiCheat)
          ?? (cfg.antiCheat.enabled && tracker ? tracker.checkOnlineRace(acct.name, p) : null)
          ?? (cfg.antiCheat.enabled ? impossibleReport(p) : null)
          ?? (cfg.antiCheat.enabled && tracker ? tracker.checkTiming(acct.name, p) : null);
      if (queued && flagged && SAVED_RESULT_REASONS.test(flagged)) flagged = `${SAVED_RESULT_PREFIX}${flagged}`;
      if (queued && ["4", "5", "6"].includes(p["location.gameMode"] ?? ""))
        diag?.event("result.queued", `${acct.name.replace(/@PSN$/, "")}: a saved result (mode ${p["location.gameMode"]}) arrived ${Math.round((Date.now() - (loginAt.get(acct.id) ?? 0)) / 1000)} s after login`,
          { account: acct.name, mode: p["location.gameMode"], track: p["location.track"] });
      const raceId = store.addRace(acct.id, p, flagged);
      tracker?.noteResult(acct.name, p, flagged);
      diag?.event("result", `${acct.name.replace(/@PSN$/, "")} posted a result: mode ${p["location.gameMode"]}, track ${p["location.track"]}, place ${p.position}${flagged ? `, kept off the boards: ${flagged}` : ""}`,
        { account: acct.name, mode: p["location.gameMode"], track: p["location.track"], position: p.position, gameId: p.gameId, flagged, raceId, svoPlatform, bytes: body.length }, flagged ? "warn" : "info");
      if (!ban.banned && cfg.antiCheat.enabled) reviewStored(store, raceId, acct.id, p);
      // the ghost of a clean Time Attack lap comes with the result as the request body; keep the driver's fastest
      if (ghostDir && !flagged && p["location.gameMode"] === "9" && p.endNormal !== "0" && body.length > 0 && saveGhost(ghostDir, acct.id, p, body, raceId))
        console.log(`[svo] ghost stored for ${acct.name}: track ${p["location.track"]}, vehicle ${p["location.vehicle"]}, ${body.length} bytes`);
      if (flagged) {
        console.warn(`[anticheat] race by ${acct.name} (${acct.id}) kept off the leaderboards: ${flagged}`);
        diag?.event("anticheat", `race by ${acct.name} kept off the leaderboards: ${flagged}`, { account: acct.name, raceId, reason: flagged }, "warn");
        if (!ban.banned && strike(store, cfg, acct.id, acct.name))
          console.warn(`[anticheat] ${acct.name} banned for ${cfg.antiCheat.autoBanHours || "unlimited"} h after ${cfg.antiCheat.autoBanStrikes} strikes`);
      }
    }
    else diag?.event("result", `a race result arrived without a login (cookie ${req.headers.cookie ? "present but unknown" : "missing"}), mode ${p["location.gameMode"]}: not stored`,
      { mode: p["location.gameMode"], track: p["location.track"], ip: req.socket.remoteAddress?.replace(/^::ffff:/, "") }, "error");
    console.log(`[svo] finishGame params ${acct.name}: ${JSON.stringify(p)}`);
    console.log(`[svo] finishGame ${acct.name}: mode=${p["location.gameMode"]} track=${p["location.track"]} ` +
      `vehicle=${p["location.vehicle"]} pos=${p.position} best=${p.bestTime}`);
    return reply(req, res, STATUS_OK);
  }

  console.log(`[svo] UNKNOWN ROUTE ${req.method} ${req.url} body=${body.toString("utf8").slice(0, 2000)}`);
  diag?.event("svo.unknown", `the game asked for ${req.method} /${path}, which the server does not know`, { url: req.url, account: acct.name, body: body.toString("utf8").slice(0, 500) }, "warn");
  return reply(req, res, STATUS_OK);
}
