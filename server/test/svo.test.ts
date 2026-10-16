import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, Config } from "../src/config.js";
import { Store } from "../src/db/store.js";
import { startSvo } from "../src/svo/server.js";
import { canForward, isLocalName, localAnswer, readQName, servFail, startDns } from "../src/dns/server.js";
import { announcementText, raceTime, raceTimeForMode } from "../src/svo/protocol.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIX = resolve(HERE, "fixtures", "svo");
const PORT = 10161;

interface Rec {
  method: string; uri: string; request_headers: Record<string, string>; request_body: string;
  status_line: string; response_headers: Record<string, string>; response_body: string;
}

const samples: [string, Rec][] = readdirSync(FIX).filter((f) => f.endsWith(".json")).flatMap((f) =>
  (JSON.parse(readFileSync(join(FIX, f), "utf8")) as Rec[]).map((r, i) => [`${f}#${i}`, r] as [string, Rec]));

function send(rec: Rec, overrides: Partial<Rec> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const r = { ...rec, ...overrides };
  const headers = Object.fromEntries(Object.entries(r.request_headers).filter(([k]) => k.toLowerCase() !== "content-length"));
  const body = Buffer.from(r.request_body, "latin1");
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port: PORT, method: r.method, path: r.uri, headers: { ...headers, "Content-Length": body.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", fail);
    req.end(body);
  });
}

const skeleton = (xml: string) => [...xml.matchAll(/<\s*([A-Za-z_][\w.-]*)/g)].map((m) => m[1]);
process.env.MSPR_TRUST_ACCT_COOKIE = "1";   // the replayed original service captures name the account in plain cookies
let cfg: Config;
let server: ReturnType<typeof startSvo>;

before(async () => {
  cfg = await loadConfig();
  cfg.svo.port = PORT;
  const dir = mkdtempSync(join(tmpdir(), "mspr-"));
  writeFileSync(join(dir, "eula.txt"), "Line one\nLine <two>");
  cfg.svo.eulaFile = join(dir, "eula.txt");
  server = startSvo(cfg, new Store(":memory:"));
  await new Promise((r) => server.once("listening", r));
});
after(() => server.close());

describe("replays every captured original service request", () => {
  for (const [name, rec] of samples) {
    test(name, async () => {
      const r = await send(rec);
      assert.equal(r.status, 200);
      const mac = rec.request_headers["X-SVOMac"];
      assert.equal(r.headers["x-svomac"], createHash("md5").update(mac + "sp9ck0348sld" + "0".repeat(20)).digest("hex"));
      assert.equal(r.headers["content-type"], "text/xml;charset=UTF-8");
      assert.equal(r.headers["content-length"], undefined);
      let want = skeleton(rec.response_body), got = skeleton(r.body);
      if (rec.uri.includes("leaderboard")) { want = want.filter((t) => t !== "user"); got = got.filter((t) => t !== "user"); }
      assert.deepEqual(got, want, r.body);
    });
  }
});

test("login reads the online id from the NP ticket, race shows up on the leaderboard", async () => {
  const login = samples.find(([n]) => n.startsWith("POST_motorstormpr_https_ticket_login"))![1];
  const r = await send(login);
  const id = /<accountID>(\d+)</.exec(r.body)![1];
  assert.equal(id, "61025");
  const finish = samples.find(([n]) => n.startsWith("POST_motorstormpr_finishGame"))![1];
  const cookie = `AcctName=Player1; X-SVOTitleID=21624; AcctID=${id}`;
  // Time Attack (mode 9, hundredths); the captured race is an online one (mode 4, milliseconds) and stays off this board
  await send(finish, { request_body: finish.request_body.replace("location.gameMode=4", "location.gameMode=9"),
    request_headers: { ...finish.request_headers, Cookie: cookie } });
  const board = await send(finish, {
    method: "GET", request_body: "", request_headers: { ...finish.request_headers, Cookie: cookie },
    uri: "/motorstormpr/leaderboard/timeattack?location.region=0&row=0&pageSize=10&location.track=2&location.vehicle=0",
  });
  assert.match(board.body, /accountName="[^"]+" accountId="61025" bestTime="186311" rank="1" vehicle="4" currentPlayer="1"/);
});

test("custom EULA text is served (escaped, 12-space indent) and acceptance is remembered", async () => {
  const eula = samples.find(([n]) => n.startsWith("GET_motorstormpr_getEula"))![1];
  const cookie = { ...eula.request_headers, Cookie: "AcctName=Player1; AcctID=61025" };
  const always = cfg.svo.eulaAlwaysShow;
  cfg.svo.eulaAlwaysShow = false;                     // remember mode (eulaAlwaysShow: false)
  let r = await send(eula, { request_headers: cookie });
  assert.match(r.body, /\n            Line one\n            Line &lt;two&gt;\n/);
  assert.match(r.body, /<accepted>false<\/accepted>/);
  const accept = samples.find(([n]) => n.startsWith("GET_motorstormpr_acceptEula"))![1];
  await send(accept, { request_headers: cookie });
  r = await send(eula, { request_headers: cookie });
  assert.match(r.body, /<accepted>true<\/accepted>/);
  writeFileSync(cfg.svo.eulaFile, "Changed rules");  // new EULA -> must be accepted again
  r = await send(eula, { request_headers: cookie });
  assert.match(r.body, /<accepted>false<\/accepted>/);
  await send(accept, { request_headers: cookie });
  cfg.svo.eulaAlwaysShow = true;                      // the original service mode: shown on every login even when accepted
  r = await send(eula, { request_headers: cookie });
  assert.match(r.body, /<accepted>false<\/accepted>/);
  cfg.svo.eulaAlwaysShow = always;
});

test("horizon account API: new Medius account and SVO login share one id, stats persist", () => {
  const s = new Store(":memory:");
  const created = s.upsertMediusAccount({ AccountName: "NewDriver@RPCN", AppId: 21624, AccountId: 5, MediusStats: null });
  assert.equal(created.AccountId, 61025);
  assert.equal(created.AccountName, "NewDriver@RPCN");
  assert.equal(s.login("NewDriver").account_id, 61025);            // SVO login (ticket online id) -> same account
  assert.ok(s.setMediusStats(61025, "AAEC"));
  const list = s.mediusAccounts();
  assert.equal(list.length, 1);
  assert.equal(list[0].MediusStats, "AAEC");
  assert.equal(list[0].AccountName, "NewDriver@RPCN");
  assert.equal(s.upsertMediusAccount({ AccountName: "Second", AppId: 21624 }).AccountId, 61026);
});

test("DNS binds to the configured interface", async () => {
  const dnsCfg = { ...cfg, lanIp: "127.0.0.1", dns: { ...cfg.dns, port: 0 } };
  const sock = startDns(dnsCfg);
  try {
    await new Promise<void>((done, fail) => {
      sock.once("listening", done);
      sock.once("error", fail);
    });
    const bound = sock.address();
    assert.ok(bound && typeof bound !== "string");
    assert.equal(bound.address, "127.0.0.1");
  } finally {
    sock.close();
  }
});

test("external DNS forwarding is limited to explicit domains", () => {
  const dnsCfg = { ...cfg, dns: { ...cfg.dns, forwardNames: ["np.rpcs3.net"] } };
  assert.equal(canForward(dnsCfg, "np.rpcs3.net"), true);
  assert.equal(canForward(dnsCfg, "status.np.rpcs3.net"), true);
  assert.equal(canForward(dnsCfg, "evilnp.rpcs3.net"), false);
  assert.equal(canForward(dnsCfg, "example.com"), false);
});

test("a real PS3 gets the PlayStation Network names resolved, the game's own names stay local", () => {
  // the default config forwards Sony's own domains: a PS3 asks for NP profiles, authentication, matching and STUN
  for (const n of ["getprof.us.np.community.playstation.net", "us.np.stun.playstation.net", "session-22012.ww.np.matching.playstation.net", "static-resource.np.community.playstation.net", "auth.np.ac.playstation.net"])
    assert.equal(canForward(cfg, n), true, n);
  for (const n of ["example.com", "evilplaystation.net", "playstation.net.evil.example", "motorstorm2ps3.online.scee.com"])
    assert.equal(canForward(cfg, n), false, n);
  assert.equal(isLocalName(cfg, "motorstorm2ps3.online.scee.com"), true);          // the local answer wins over any forwarding
});

test("dns answers game domains locally", () => {
  const name = "motorstorm2ps3.online.scee.com";
  const q = Buffer.concat([Buffer.from([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
    ...name.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0, 0, 1, 0, 1])]);
  assert.equal(readQName(q)[0], name);
  assert.ok(isLocalName(cfg, name) && isLocalName(cfg, "svo.psrewired.com") && !isLocalName(cfg, "google.com"));
  const a = localAnswer(q, "10.1.2.3");
  assert.equal(a.readUInt16BE(6), 1);
  assert.deepEqual([...a.subarray(a.length - 4)], [10, 1, 2, 3]);
  const f = servFail(q);                                   // upstream silent -> still answer (rcode 2)
  assert.equal(f.readUInt16BE(0), 0x1234);
  assert.equal(f.readUInt16BE(2) & 0x800f, 0x8002);
  assert.equal(readQName(f)[0], name);
});

test("race times are hundredths of a second like the game shows them", () => {
  assert.equal(raceTime(8048), "1:20.48");
  assert.equal(raceTime(8139), "1:21.39");
  assert.equal(raceTime(605), "0:06.05");
  assert.equal(raceTime(0), "");
});

test("anti-cheat keeps impossible race reports off the leaderboards", async () => {
  const { checkRace, DEFAULT_ANTICHEAT } = await import("../src/svo/anticheat.js");
  const real = { "location.gameMode": "9", "location.track": "1", "location.vehicle": "1", laps: "2", bestTime: "8048",
    bestTimeSplit1: "2356", bestTimeSplit2: "3139", bestTimeSplit3: "2553" };     // a real game report
  assert.equal(checkRace(real, 0, DEFAULT_ANTICHEAT), null);
  assert.match(checkRace({ ...real, bestTime: "900", bestTimeSplit1: "300", bestTimeSplit2: "300", bestTimeSplit3: "300" }, 0, DEFAULT_ANTICHEAT)!, /minimum/);
  assert.match(checkRace({ ...real, bestTime: "7000" }, 0, DEFAULT_ANTICHEAT)!, /add up/);
  assert.match(checkRace({ ...real, bestTime: "abc" }, 0, DEFAULT_ANTICHEAT)!, /positive/);
  assert.match(checkRace({ ...real, "location.track": "5000" }, 0, DEFAULT_ANTICHEAT)!, /out of range/);
  assert.equal(checkRace({ ...real, laps: "119" }, 0, DEFAULT_ANTICHEAT), null);                       // a Time Attack practice session has no lap limit
  assert.match(checkRace({ ...real, "location.gameMode": "5", laps: "119" }, 0, DEFAULT_ANTICHEAT)!, /out of range/);   // a race does
  assert.match(checkRace(real, 6, DEFAULT_ANTICHEAT)!, /within a minute/);
  assert.equal(checkRace({ ...real, bestTime: "1" }, 0, { ...DEFAULT_ANTICHEAT, enabled: false }), null);

  const s = new Store(":memory:");
  const a = s.login("Cheater");
  s.addRace(a.account_id, { ...real, endNormal: "1" }, null);
  s.addRace(a.account_id, { ...real, bestTime: "2500", endNormal: "1" }, "bestTime too fast");
  const board = s.board("1", "0", null);
  assert.equal(board.length, 1);
  assert.equal(board[0].bestTime, 8048);                     // the flagged 25.00 s lap is not used
  assert.equal(s.recentRaceCount(a.account_id), 2);
});

test("PSN (real PS3) and RPCN (RPCS3) players with the same name get separate accounts", async () => {
  const { parseNpTicket, isPsnTicket } = await import("../src/svo/protocol.js");
  const rpcn = Buffer.from(samples.find(([n]) => n.startsWith("POST_motorstormpr_https_ticket_login"))![1].request_body, "latin1");
  const t = parseNpTicket(rpcn);
  assert.equal(t.signer, "RPCN");
  assert.equal(isPsnTicket(t), false);
  // a PSN ticket carries a binary key id in the signature section instead of "RPCN"
  const psn = Buffer.from(rpcn);
  psn.set([0x71, 0x9f, 0x1d, 0x4a], rpcn.indexOf("RPCN"));
  assert.equal(isPsnTicket(parseNpTicket(psn)), true);

  const s = new Store(":memory:");
  const r = s.upsertMediusAccount({ AccountName: "Driver@RPCN", AppId: 21624 });
  const p = s.upsertMediusAccount({ AccountName: "Driver", AppId: 21624 });
  assert.notEqual(r.AccountId, p.AccountId);
  assert.equal(s.login("Driver").account_id, r.AccountId);          // RPCN SVO login
  assert.equal(s.login("Driver@PSN").account_id, p.AccountId);      // PSN SVO login
  s.addRace(p.AccountId as number, { "location.gameMode": "9", "location.track": "1", "location.vehicle": "1", bestTime: "8048", endNormal: "1" });
  assert.equal(s.board("1", "0", null)[0].accountName, "Driver");   // shown without the @PSN key suffix
});

test("online anti-cheat: race reports need a real game, bans block logins and reports", async () => {
  const { OnlineTracker, banCheck, strike, accountKey } = await import("../src/online/integrity.js");
  assert.equal(accountKey("Driver@RPCN"), "Driver");
  assert.equal(accountKey("Driver"), "Driver@PSN");

  const t = new OnlineTracker(cfg);
  const casual = { "location.gameMode": "6", "location.track": "3", position: "1", bestTime: "9000" };
  t.record([]);                                                         // Horizon reachable, nobody in a game
  assert.match(t.checkOnlineRace("Driver", casual)!, /no casual game/);
  t.record([{ worldId: 2, type: "casual", players: [{ name: "Driver@RPCN" }, { name: "Other" }] }]);
  assert.equal(t.checkOnlineRace("Driver", casual), null);             // was in a 2-player casual game
  assert.match(t.checkOnlineRace("Driver", { ...casual, position: "5" })!, /placing 6/);
  assert.match(t.checkOnlineRace("Driver", { ...casual, "location.gameMode": "5" })!, /no ranked game/);
  assert.equal(t.checkOnlineRace("Other@PSN", casual), null);          // PSN player tracked under name@PSN
  assert.equal(t.checkOnlineRace("Driver", { ...casual, "location.gameMode": "9" }), null); // Time Attack is offline

  const s = new Store(":memory:");
  assert.equal(banCheck(s, cfg, "Driver", "10.0.0.5").banned, false);
  s.addBan("ip", "10.0.0.5", "test", 1);
  assert.equal(banCheck(s, cfg, "Someone", "10.0.0.5").banned, true);
  const a = s.login("Cheater");
  const flaggedRace = { "location.track": "1", bestTime: "100", endNormal: "1" };
  for (let i = 0; i < 3; i++) s.addRace(a.account_id, flaggedRace, "too fast");
  assert.equal(strike(s, cfg, a.account_id, "Cheater"), true);          // 3 strikes -> temporary ban
  assert.match(banCheck(s, cfg, "Cheater", null).reason!, /3 anti-cheat strikes.*until/);
  assert.equal(s.removeBans("account", "Cheater"), 1);
  assert.equal(banCheck(s, cfg, "Cheater", null).banned, false);

  // stats blob audit: malformed or oversized blobs are refused, valid ones are versioned
  assert.equal(s.setMediusStats(a.account_id, "not base64!"), false);
  assert.equal(s.setMediusStats(a.account_id, Buffer.alloc(300).toString("base64")), false);
  assert.equal(s.setMediusStats(a.account_id, Buffer.alloc(256, 1).toString("base64")), true);
  assert.equal(s.statsHistory(a.account_id).length, 1);
});

test("online modes report milliseconds, offline modes hundredths", () => {
  assert.equal(raceTimeForMode(5, 187326), "3:07.33");
  assert.equal(raceTimeForMode("9", 16119), "2:41.19");
});

describe("announcement text", () => {
  test("short text is untouched, long text is cut at 1023 bytes without splitting a character", () => {
    assert.equal(announcementText("hello"), "hello");
    const cut = announcementText("a".repeat(1000) + "ä".repeat(50));
    assert.ok(Buffer.byteLength(cut) <= 1023);
    assert.ok(!cut.includes("�"));
    assert.equal(announcementText("x".repeat(2000)).length, 1023);
  });
});

test("a saved result that arrives after login is no strike, a real violation still is", async () => {
  const { SAVED_RESULT_PREFIX } = await import("../src/svo/anticheat.js");
  const { strike } = await import("../src/online/integrity.js");
  const s = new Store(":memory:");
  const a = s.login("PsnPlayerTwo@PSN");
  const race = { "location.gameMode": "4", "location.track": "18", "location.vehicle": "2", bestTime: "113033", endNormal: "1" };
  for (let i = 0; i < 5; i++) s.addRace(a.account_id, race, `${SAVED_RESULT_PREFIX}custom race reported but the player was in no custom game on the server`);
  assert.equal(s.flaggedRaceCount(a.account_id, 24 * 3600), 0);
  assert.equal(strike(s, cfg, a.account_id, "PsnPlayerTwo@PSN"), false);
  assert.ok(!s.activeBan("account", "PsnPlayerTwo@PSN"));
  // reasons that compare the report with what Horizon saw are no strikes either
  for (const why of ["custom race reported but the player was in no custom game on the server", "placing 9 in a game of 3 players", "race time 400.0 s is longer than the 30.0 s since the player joined the game", "banned account (x)"])
    s.addRace(a.account_id, race, why);
  assert.equal(s.flaggedRaceCount(a.account_id, 24 * 3600), 0);
  for (let i = 0; i < 3; i++) s.addRace(a.account_id, { ...race, bestTime: "5" }, "bestTime below the minimum");
  assert.equal(s.flaggedRaceCount(a.account_id, 24 * 3600), 3);
  assert.equal(strike(s, cfg, a.account_id, "PsnPlayerTwo@PSN"), true);
});

test("the board row names the vehicle of the fastest lap, not of a run without a time", () => {
  const s = new Store(":memory:");
  const a = s.login("PsnPlayerOne@PSN");
  const ta = { "location.gameMode": "9", "location.track": "15", endNormal: "1" };
  s.addRace(a.account_id, { ...ta, "location.vehicle": "1" }, null);                                  // a Bike run without a lap time
  s.addRace(a.account_id, { ...ta, "location.vehicle": "2", bestTime: "7446" }, null);                 // ATV, the real lap
  s.addRace(a.account_id, { ...ta, "location.vehicle": "3", bestTime: "8000" }, null);                 // slower Buggy lap
  const any = s.board("15", "0", null);
  assert.equal(any.length, 1);
  assert.equal(any[0].bestTime, 7446);
  assert.equal(any[0].vehicle, "2");
  assert.equal(s.board("15", "1", null).length, 0);                                                    // no Bike time
  assert.equal(s.board("15", "3", null)[0].bestTime, 8000);
});

test("a Time Attack lap counts whatever the session end code is, except a lost connection", () => {
  const s = new Store(":memory:");
  const a = s.login("PsnPlayerOne@PSN"), b = s.login("Other");
  const ta = { "location.gameMode": "9", "location.track": "7", "location.vehicle": "2" };
  s.addRace(a.account_id, { ...ta, bestTime: "4985", endNormal: "5", laps: "6" }, null);     // real report: quit after six laps
  s.addRace(b.account_id, { ...ta, bestTime: "3000", endNormal: "0" }, null);                 // connection lost: not a lap
  const board = s.board("7", "0", null);
  assert.deepEqual(board.map((r) => [r.accountName, r.bestTime]), [["PsnPlayerOne", 4985]]);
  assert.equal(s.tracks().find((t) => t.track === "7")?.bestTime, 4985);
});

test("with the anti-cheat off, earlier rejection marks no longer hide races from the boards", () => {
  const s = new Store(":memory:");
  const a = s.login("PsnPlayerOne@PSN");
  const ta = { "location.gameMode": "9", "location.track": "5", "location.vehicle": "1", bestTime: "6683", endNormal: "2", laps: "119" };
  s.addRace(a.account_id, ta, "laps=119 out of range");
  assert.equal(s.board("5", "0", null).length, 0);                       // anti-cheat on: kept off
  assert.equal(s.tracks().length, 0);
  s.ignoreFlags = true;                                                   // anti-cheat off
  assert.deepEqual(s.board("5", "0", null).map((r) => r.bestTime), [6683]);
  assert.equal(s.tracks()[0].bestTime, 6683);
  assert.equal(s.playerProfile(a).timeAttackBests.length, 1);
});
