import { accountKey, banCheck } from "../../online/integrity.js";
import type { Ctx } from "../context.js";

/**
 * Horizon's private interface: MSPR accounts, Medius stats and the ban check at login. Only answered on the
 * loopback address (Horizon runs on the same machine).
 */
export async function horizonApi(c: Ctx): Promise<void> {
  const { req, url, store } = c;
  const body = await new Promise<string>((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (d: Buffer) => { size += d.length; if (size <= 1024 * 1024) chunks.push(d); });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
  });
  const path = url.pathname;
  if (req.method === "GET" && path === "/horizon/accounts") return c.json(store.mediusAccounts());
  if (req.method === "POST" && path === "/horizon/accounts") return c.json(store.upsertMediusAccount(JSON.parse(body)));
  if (req.method === "DELETE" && path === "/horizon/test-races") return c.json({ deleted: store.deleteTestRaces() });
  // anti-cheat: Horizon asks at every Medius login (name = Horizon account name, e.g. "Name@RPCN")
  if (req.method === "GET" && path === "/horizon/ban-check") {
    const name = url.searchParams.get("name");
    return c.json(banCheck(store, c.cfg, name ? accountKey(name) : null, url.searchParams.get("ip")));
  }
  // admin (this PC only): POST {"kind":"account"|"ip","value":"Name","reason":"...","hours":24|null}, DELETE ?kind=&value=
  if (path === "/horizon/bans" && req.method === "POST") {
    const b = JSON.parse(body) as { kind: "account" | "ip"; value: string; reason?: string; hours?: number | null };
    if ((b.kind !== "account" && b.kind !== "ip") || typeof b.value !== "string" || !b.value.trim()) return c.fail(400, { error: "kind must be account or ip, and value is required" });
    store.addBan(b.kind, b.value, b.reason ?? "banned by the server admin", b.hours ?? null);
    return c.json({ ok: true, bans: store.bans() });
  }
  if (path === "/horizon/bans" && req.method === "DELETE")
    return c.json({ removed: store.removeBans(url.searchParams.get("kind") as "account" | "ip", url.searchParams.get("value") ?? "") });
  const history = /^\/horizon\/accounts\/(\d+)\/stats-history$/.exec(path);
  if (req.method === "GET" && history) return c.json(store.statsHistory(Number(history[1])));
  const stats = /^\/horizon\/accounts\/(\d+)\/stats$/.exec(path);
  if (req.method === "PUT" && stats) {
    const blob = JSON.parse(body) as string;               // Horizon posts the base64 blob as a JSON string
    return c.json({ ok: store.setMediusStats(Number(stats[1]), blob) });
  }
  c.res.writeHead(404);
  c.res.end();
}
