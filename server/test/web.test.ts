import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { DEFAULT_ANTICHEAT } from "../src/svo/anticheat.js";
import type { Config } from "../src/config.js";
import { Store } from "../src/db/store.js";
import { startWeb } from "../src/web/server.js";

/** The status site and API over a real socket, with an in-memory database and no Horizon behind it. */
const cfg = {
  lanIp: "127.0.0.1", publicIp: null,
  svo: { host: "auto", port: 0, region: { id: 1, mediusLocation: "us" }, eulaFile: "eula.txt", announcementFile: "announcement.txt", eulaAlwaysShow: true },
  dns: { port: 0, upstream: "127.0.0.1", localNames: [], localSuffixes: [] },
  web: { port: 0 }, horizon: { crudUrl: "http://127.0.0.1:9", appId: 21624 }, database: ":memory:",
  leaderboards: { timeattackModes: null, speedModes: null }, antiCheat: { ...DEFAULT_ANTICHEAT },
} as unknown as Config;

const store = new Store(":memory:");
let server: Server;
let base = "";
const get = (path: string) => fetch(base + path);
const json = async (path: string) => (await get(path)).json() as Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  const a = store.login("Alice", "1"), b = store.login("Bob", "2");
  const rep = (over: Record<string, string>) => ({ "location.gameMode": "5", "location.track": "17", "location.vehicle": "2", gameId: "2", laps: "2", endNormal: "1", bestTime: "187326", totalRaceTime: "187110", ...over });
  store.addRace(a.account_id, rep({ placed1: "1", won: "1", score: "101", playersBeaten: "1" }));
  store.addRace(b.account_id, rep({ placed2: "1", totalRaceTime: "216883", score: "1" }));
  store.addRace(a.account_id, { "location.gameMode": "9", "location.track": "1", "location.vehicle": "4", bestTime: "8048", endNormal: "1" });
  store.addRace(b.account_id, rep({ placed1: "1", totalRaceTime: "1" }), "test rejection");
  server = startWeb(cfg, store);
  await new Promise<void>((done) => server.once("listening", () => done()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); store.close(); });

describe("page and headers", () => {
  test("the page is served with a content security policy", async () => {
    const r = await get("/");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type")!, /text\/html/);
    assert.match(r.headers.get("content-security-policy")!, /default-src 'self'/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(await r.text(), /<title>MSPR/);
  });
  test("the API is open for reading from other sites", async () => {
    assert.equal((await get("/api/meta")).headers.get("access-control-allow-origin"), "*");
  });
  test("unknown paths are 404", async () => {
    assert.equal((await get("/nope")).status, 404);
    assert.equal((await get("/api/nope")).status, 404);
  });
});

describe("API", () => {
  test("/api lists itself and /api/health reports without Horizon", async () => {
    const index = await json("/api");
    assert.ok(index.some((e: { path: string }) => e.path.startsWith("/api/matches")));
    const h = await json("/api/health");
    assert.equal(h.ok, true);
    assert.equal(h.accounts, 2);
    assert.match(h.horizon, /unreachable/);
  });
  test("/api/meta has the name tables", async () => {
    const m = await json("/api/meta");
    assert.equal(m.tracks["17"], "Reef Runner");
    assert.equal(m.modes["5"], "Ranked");
  });
  test("/api/ranked, /api/leaderboard and /api/leaderboards", async () => {
    const r = await get("/api/ranked");
    assert.equal(r.headers.get("x-total-count"), "2");
    const rows = await r.json() as { accountName: string; stats: { score: number } }[];
    assert.deepEqual(rows.map((x) => [x.accountName, x.stats.score]), [["Alice", 101], ["Bob", 1]]);
    assert.equal((await json("/api/leaderboard?kind=ranked&limit=1")).length, 1);
    const board = await json("/api/leaderboard?track=1&vehicle=0");
    assert.deepEqual(board.rows.map((x: { accountName: string; bestTimeText: string }) => [x.accountName, x.bestTimeText]), [["Alice", "1:20.48"]]);
    assert.equal(board.trackName, "Kanaloa Bay");
    assert.equal((await json("/api/leaderboards")).length, 1);
  });
  test("/api/matches and /api/match group the reports of a race", async () => {
    const r = await get("/api/matches?limit=10");
    assert.equal(r.headers.get("x-total-count"), "3");
    const list = await r.json() as { id: number; modeName: string; players: { name: string; place: number; timeText: string }[]; winner: string | null }[];
    const ranked = list.find((m) => m.modeName === "Ranked" && m.players.length === 2)!;
    assert.deepEqual(ranked.players.map((p) => [p.place, p.name, p.timeText]), [[1, "Alice", "3:07.11"], [2, "Bob", "3:36.88"]]);
    assert.equal(ranked.winner, "Alice");
    const one = await json(`/api/match?id=${ranked.id}`);
    assert.equal(one.trackName, "Reef Runner");
    assert.equal((await get("/api/match?id=9999")).status, 404);
    assert.equal((await get("/api/match?id=abc")).status, 404);
    assert.equal((await json("/api/matches?player=Bob")).length, 2);
    assert.equal((await get("/api/matches?player=nobody")).headers.get("x-total-count"), "0");
  });
  test("/api/races pages and filters", async () => {
    const r = await get("/api/races?limit=2&mode=5");
    assert.equal(r.headers.get("x-total-count"), "3");
    const rows = await r.json() as { place: number; gameModeName: string }[];
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => x.gameModeName === "Ranked"));
  });
  test("/api/player, /api/drivers, /api/records, /api/summary", async () => {
    const p = await json("/api/player?name=Alice");
    assert.equal(p.ranked.rank, 1);
    assert.equal(p.online, false);
    assert.equal((await get("/api/player?name=nobody")).status, 404);
    const d = await get("/api/drivers?q=bo");
    assert.equal(d.headers.get("x-total-count"), "1");
    assert.equal(((await d.json()) as { name: string }[])[0].name, "Bob");
    assert.equal((await json("/api/records"))[0].bestTimeText, "1:20.48");
    const s = await json("/api/summary");
    assert.ok(s.byMode.some((m: { modeName: string }) => m.modeName === "Ranked"));
    assert.ok(s.perDayByMode.length >= 1);
  });
  test("/api/tracks and /api/track", async () => {
    const t = await json("/api/tracks");
    assert.deepEqual(t.map((x: { trackName: string }) => x.trackName), ["Kanaloa Bay", "Reef Runner"]);
    const one = await json("/api/track?id=17");
    assert.equal(one.races, 3);
    assert.ok(one.recent.length >= 1);
    assert.equal((await get("/api/track?id=999")).status, 404);
  });
  test("/api/anticheat lists the rejected race with its reason", async () => {
    const a = await json("/api/anticheat");
    assert.equal(a.counts.rejectedTotal, 1);
    assert.equal(a.rejected[0].reason, "test rejection");
    assert.equal(a.rejected[0].trackName, "Reef Runner");
  });
  test("live data endpoints answer with an error object while Horizon is down", async () => {
    assert.ok((await json("/api/players")).error);
    assert.ok((await json("/api/games")).error);
    assert.ok((await json("/api/matchmaking")).error);
  });
  test("/api/status and /api/bans", async () => {
    const s = await json("/api/status");
    assert.equal(s.accounts, 2);
    assert.equal(s.matches, 3);
    assert.equal(typeof s.announcement, "string");
    assert.deepEqual(await json("/api/bans"), []);
  });
});

describe("Horizon's account API (loopback)", () => {
  test("ban check, stats and bans", async () => {
    assert.equal((await json("/horizon/ban-check?name=Alice%40RPCN&ip=1.2.3.4")).banned, false);
    const add = await fetch(`${base}/horizon/bans`, { method: "POST", body: JSON.stringify({ kind: "account", value: "Mallory", hours: 1 }) });
    assert.equal(add.status, 200);
    assert.equal((await json("/horizon/ban-check?name=Mallory")).banned, false);          // a PSN account is keyed "Mallory@PSN"
    assert.equal((await json("/horizon/ban-check?name=Mallory%40RPCN")).banned, true);    // an RPCN account is keyed "Mallory"
    assert.equal((await json("/api/bans")).length, 1);
    const del = await fetch(`${base}/horizon/bans?kind=account&value=Mallory`, { method: "DELETE" });
    assert.equal((await del.json() as { removed: number }).removed, 1);
  });
  test("unknown internal routes are 404", async () => {
    assert.equal((await get("/horizon/nope")).status, 404);
  });
});

describe("static assets and compression", () => {
  test("the stylesheet and the modules are served, with an ETag that revalidates", async () => {
    const css = await get("/assets/app.css");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type")!, /text\/css/);
    const etag = css.headers.get("etag")!;
    assert.ok(etag);
    assert.equal((await fetch(base + "/assets/app.css", { headers: { "If-None-Match": etag } })).status, 304);
    const js = await get("/assets/js/main.js");
    assert.match(js.headers.get("content-type")!, /text\/javascript/);
    assert.match(await js.text(), /hooks\.render = render/);
  });
  test("an asset path cannot leave the assets folder", async () => {
    const { get: httpGet } = await import("node:http");
    // sent as written (fetch would tidy the dots away first)
    const status = (path: string) => new Promise<number>((done) => httpGet(base + path, (r) => { r.resume(); done(r.statusCode ?? 0); }));
    for (const p of ["/assets/..%2fserver.ts", "/assets/%2e%2e%2f%2e%2e%2fpackage.json", "/assets/js/..%2f..%2f..%2fserver.ts", "/assets/nope.js", "/assets/app.txt", "/assets/%E0%A4%A", "/assets/js/"])
      assert.equal(await status(p), 404, p);
  });
  test("the page references its assets and has no inline script", async () => {
    const html = await (await get("/")).text();
    assert.match(html, /href="\/assets\/app\.css"/);
    assert.match(html, /<script type="module" src="\/assets\/js\/main\.js"><\/script>/);
    assert.equal(/<script>/.test(html), false);
  });
  test("large responses are gzip-compressed for clients that accept it", async () => {
    const { get: httpGet } = await import("node:http");
    const res = await new Promise<import("node:http").IncomingMessage>((done) => httpGet(base + "/api", { headers: { "Accept-Encoding": "gzip" } }, done));
    assert.equal(res.headers["content-encoding"], "gzip");
    res.resume();
    const plain = await new Promise<import("node:http").IncomingMessage>((done) => httpGet(base + "/api", done));
    assert.equal(plain.headers["content-encoding"], undefined);
    plain.resume();
  });
});

/** A second site with every restriction on. The test client is on loopback, so a remote viewer is simulated with X-Forwarded-For. */
describe("privacy controls", () => {
  const strict = { ...cfg, web: { port: 0, adminToken: "s3cret-token", privacy: { anticheat: "admin", bans: "admin", live: "admin", raceHistory: "admin", pseudonymize: true, salt: "test-salt" } } } as unknown as Config;
  let s2: Server;
  let b2 = "";
  const remote = { "x-forwarded-for": "203.0.113.9" };
  const as = (path: string, headers: Record<string, string> = remote) => fetch(b2 + path, { headers });

  before(async () => {
    s2 = startWeb(strict, store);
    await new Promise<void>((done) => s2.once("listening", () => done()));
    b2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
  });
  after(() => { s2.close(); });

  test("the anti-cheat report is hidden from the public by default, open for the local machine", async () => {
    const open = { ...cfg, web: { port: 0, privacy: { anticheat: "admin" } } } as unknown as Config;
    assert.equal((await get("/api/anticheat")).status, 200);                    // loopback = the server's own machine
    const s3 = startWeb({ ...open, web: { ...open.web, privacy: { ...(await import("../src/web/privacy.js")).DEFAULT_PRIVACY } } } as unknown as Config, store);
    await new Promise<void>((done) => s3.once("listening", () => done()));
    try {
      const url = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
      assert.equal((await fetch(url + "/api/anticheat", { headers: remote })).status, 403);
      assert.equal((await fetch(url + "/api/anticheat")).status, 200);
      assert.equal((await fetch(url + "/api/bans", { headers: remote })).status, 200);   // the other sections stay public by default
      assert.equal((await fetch(url + "/api/matches", { headers: remote })).status, 200);
    } finally { s3.close(); }
  });

  test("every restricted section answers 403 to a remote viewer and 200 with the token", async () => {
    for (const p of ["/api/anticheat", "/api/bans", "/api/players", "/api/games", "/api/matchmaking", "/api/races", "/api/matches", "/api/match?id=1"]) {
      assert.equal((await as(p)).status, 403, p);
      const ok = await as(p, { ...remote, authorization: "Bearer s3cret-token" });
      assert.notEqual(ok.status, 403, p);
    }
    assert.equal((await as("/api/anticheat", { ...remote, "x-admin-token": "s3cret-token" })).status, 200);
    assert.equal((await as("/api/anticheat", { ...remote, authorization: "Bearer wrong-token" })).status, 403);
    assert.equal((await as("/api/anticheat", { ...remote, authorization: "Bearer s3cret-tokeX" })).status, 403);
  });

  test("the diagnostics journal is admin only, whatever the privacy settings say", async () => {
    const open = { ...cfg, web: { port: 0, privacy: { anticheat: "public", bans: "public", live: "public", raceHistory: "public" } } } as unknown as Config;
    const s3 = startWeb(open, store);
    await new Promise<void>((done) => s3.once("listening", () => done()));
    try {
      const url = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
      assert.equal((await fetch(url + "/api/diagnostics", { headers: remote })).status, 403);
      assert.equal((await fetch(url + "/api/diagnostics")).status, 200);
      assert.equal((await (await fetch(url + "/api/access", { headers: remote })).json() as { diagnostics: boolean }).diagnostics, false);
    } finally { s3.close(); }
    const ok = await as("/api/diagnostics", { ...remote, authorization: "Bearer s3cret-token" });
    assert.equal(ok.status, 200);
    const body = await ok.json() as { games: unknown[]; events: unknown[] };
    assert.ok(Array.isArray(body.games) && Array.isArray(body.events));
  });

  test("a request through a proxy is not treated as local, a direct local one is", async () => {
    assert.equal((await as("/api/anticheat", {})).status, 200);
    assert.equal((await as("/api/anticheat", remote)).status, 403);
  });

  test("/api/access tells the page what it may show", async () => {
    const a = await (await as("/api/access")).json() as Record<string, boolean>;
    assert.deepEqual(a, { admin: false, anticheat: false, bans: false, live: false, raceHistory: false, diagnostics: false, pseudonymized: true, tokenLogin: true });
    const b = await (await as("/api/access", { ...remote, authorization: "Bearer s3cret-token" })).json() as Record<string, boolean>;
    assert.equal(b.admin, true);
    assert.equal(b.anticheat, true);
    assert.equal(b.pseudonymized, false);
  });

  test("names become stable aliases for a remote viewer but not for an admin", async () => {
    const pub = JSON.stringify(await (await as("/api/ranked")).json());
    assert.ok(!/Alice|Bob/.test(pub), pub);
    assert.match(pub, /Driver-[0-9a-f]{6}/);
    for (const p of ["/api/drivers", "/api/leaderboard?track=1&vehicle=4", "/api/leaderboards", "/api/records", "/api/status", "/api/summary", "/api/tracks", "/api/track?id=17"])
      assert.ok(!/Alice|Bob/.test(JSON.stringify(await (await as(p)).json())), p);
    assert.equal(JSON.stringify(await (await as("/api/ranked")).json()), pub);          // stable between requests
    const admin = JSON.stringify(await (await as("/api/ranked", { ...remote, authorization: "Bearer s3cret-token" })).json());
    assert.match(admin, /Alice/);
  });

  test("a driver is looked up by alias, not by the real name", async () => {
    const rows = await (await as("/api/drivers")).json() as { name: string }[];
    const alias = rows.find((r) => /^Driver-/.test(r.name))!.name;
    const p = await as("/api/player?name=" + alias);
    assert.equal(p.status, 200);
    const prof = await p.json() as { name: string; recent: unknown[]; online: boolean };
    assert.equal(prof.name, alias);
    assert.deepEqual(prof.recent, []);                          // race history is restricted
    assert.equal((await as("/api/player?name=Alice")).status, 404);
  });

  test("live data and race history are left out of the status for a remote viewer", async () => {
    const st = await (await as("/api/status")).json() as { recent: unknown[]; online: { players: unknown[]; games: unknown[]; count: number } };
    assert.deepEqual(st.recent, []);
    assert.deepEqual(st.online.players, []);
    assert.deepEqual(st.online.games, []);
    assert.equal(typeof st.online.count, "number");
    assert.deepEqual((await (await as("/api/track?id=17")).json() as { recent: unknown[] }).recent, []);
  });

  test("Horizon's interface stays loopback only whatever the privacy settings are", async () => {
    // a request that came through a proxy is not local, even with the admin token
    assert.equal((await as("/horizon/accounts")).status, 403);
    assert.equal((await as("/horizon/accounts", { ...remote, authorization: "Bearer s3cret-token" })).status, 403);
    assert.equal((await as("/horizon/bans", { ...remote, authorization: "Bearer s3cret-token" })).status, 403);
    assert.equal((await as("/horizon/accounts", {})).status, 200);                 // Horizon itself, direct on loopback
  });
});

describe("RPCS3 patch download", () => {
  test("the patch file is offered as a download", async () => {
    const r = await get("/downloads/imported_patch.yml");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="imported_patch.yml"/);
    const text = await r.text();
    assert.match(text, /Keep Custom Game settings after Ranked\/Casual/);
    assert.match(text, /0x002804e4/);
  });
});
