import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { DEFAULT_ANTICHEAT, checkRace } from "../src/svo/anticheat.js";
import type { Config } from "../src/config.js";
import { Store } from "../src/db/store.js";
import { raceTimeForMode } from "../src/svo/protocol.js";
import { startSvo } from "../src/svo/server.js";

/** What a real Speed Weekend finishGame looked like: the best "time" is the time left on the countdown. */
const weekend = (over: Record<string, string> = {}) => ({
  "location.gameMode": "11", "location.track": "14", "location.vehicle": "1", endState: "1", endNormal: "1", laps: "1", position: "1",
  bestTime: "22431", timeRemaining: "22431", totalRaceTime: "70232", totalRaceTimeInFirst: "70232", won: "1", wrecks: "1", ...over,
});

describe("Speed / Volcano Weekend reports", () => {
  test("the time left is not a lap time: tiny or zero values are not rejected", () => {
    assert.equal(checkRace(weekend(), 0, DEFAULT_ANTICHEAT), null);
    assert.equal(checkRace(weekend({ bestTime: "500" }), 0, DEFAULT_ANTICHEAT), null);
    assert.equal(checkRace(weekend({ bestTime: "0" }), 0, DEFAULT_ANTICHEAT), null);
    assert.match(checkRace(weekend({ "location.track": "5000" }), 0, DEFAULT_ANTICHEAT)!, /out of range/);    // ranges and the rate still apply
    assert.match(checkRace(weekend(), 6, DEFAULT_ANTICHEAT)!, /within a minute/);
    assert.match(checkRace({ ...weekend(), "location.gameMode": "9", bestTime: "500" }, 0, DEFAULT_ANTICHEAT)!, /minimum/);   // Time Attack is still judged
  });
  test("times are milliseconds in the Weekend modes and hundredths in Time Attack", () => {
    assert.equal(raceTimeForMode(11, 70232), "1:10.23");
    assert.equal(raceTimeForMode(10, 22431), "0:22.43");
    assert.equal(raceTimeForMode(9, 8048), "1:20.48");
  });
});

describe("boards of the two kinds stay apart", () => {
  const s = new Store(":memory:");
  const a = s.login("Alice", "1"), b = s.login("Bob", "2");
  s.addRace(a.account_id, weekend());                                                       // 22.4 s left
  s.addRace(b.account_id, weekend({ bestTime: "31000", "location.vehicle": "1" }));         // 31.0 s left
  s.addRace(a.account_id, weekend({ "location.gameMode": "10", bestTime: "5000" }));        // a Volcano Weekend run, 5 s left
  s.addRace(a.account_id, { "location.gameMode": "9", "location.track": "14", "location.vehicle": "1", bestTime: "9000", endNormal: "1" });

  test("the Time Attack board holds only Time Attack runs", () => {
    assert.deepEqual(s.board("14", "0", null).map((r) => [r.accountName, r.bestTime]), [["Alice", 9000]]);
    assert.equal(s.tracks().length, 1);
    assert.equal(s.records().length, 1);
  });
  test("the Weekend board ranks the most time left first, one row per driver", () => {
    assert.deepEqual(s.speedBoard("14", "0").map((r) => [r.rank, r.accountName, r.timeRemaining]), [[1, "Bob", 31000], [2, "Alice", 22431]]);
    assert.equal(s.speedBoard("14", "2").length, 0);                                        // another vehicle
    assert.deepEqual(s.speedTracks().map((t) => [t.track, t.players, t.races, t.timeRemaining]), [["14", 2, 3, 31000]]);
  });
});

describe("the game's Weekend leaderboard request", () => {
  const cfg = { lanIp: "127.0.0.1", publicIp: null, svo: { host: "auto", port: 0, region: { id: 1, mediusLocation: "us" }, eulaFile: "eula.txt", announcementFile: "announcement.txt", eulaAlwaysShow: true },
    dns: { port: 0, upstream: "127.0.0.1", localNames: [], localSuffixes: [] }, web: { port: 0 }, horizon: { crudUrl: "http://127.0.0.1:9", appId: 21624 }, database: ":memory:",
    leaderboards: { timeattackModes: null, speedModes: null }, antiCheat: { ...DEFAULT_ANTICHEAT } } as unknown as Config;
  const store = new Store(":memory:");
  let server: Server;
  let base = "";
  before(async () => {
    const a = store.login("Alice", "1");
    store.addRace(a.account_id, weekend());
    server = startSvo(cfg, store);
    await new Promise<void>((done) => server.once("listening", () => done()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => { server.close(); store.close(); });

  test("rows carry timeRemaining and vehicle, the stats the game asks for", async () => {
    const r = await fetch(`${base}/motorstormpr/leaderboard/speed?location.region=0&row=0&pageSize=10&location.track=14&location.vehicle=1&stat.timeRemaining=22431&stat.vehicle=1`);
    const xml = await r.text();
    assert.match(xml, /<user accountName="Alice" accountId="\d+" timeRemaining="22431" rank="1" vehicle="1"/);
    assert.equal(/bestTime=/.test(xml), false);
  });
  test("an empty board is a valid empty frame", async () => {
    const xml = await (await fetch(`${base}/motorstormpr/leaderboard/speed?location.region=0&row=0&pageSize=10&location.track=3&location.vehicle=1`)).text();
    assert.match(xml, /<userStats>\r?\n\s*<\/userStats>/);
  });
});

describe("Time Attack ghosts", () => {
  test("a ghost is kept per driver, track and vehicle and replaced only by a faster lap", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { ghostMeta, saveGhost } = await import("../src/svo/ghosts.js");
    const dir = join(mkdtempSync(join(tmpdir(), "mspr-ghost-")), "ghosts");
    const ta = (bestTime: string, body: Buffer) => ({ p: { "location.gameMode": "9", "location.track": "1", "location.vehicle": "5", bestTime, ghostLength: String(body.length) }, body });
    const slow = ta("8000", Buffer.from("slow-ghost")), fast = ta("7845", Buffer.from("fast-ghost!")), slower = ta("9000", Buffer.from("slower"));
    assert.equal(saveGhost(dir, 61025, slow.p, slow.body, 1), true);
    assert.equal(ghostMeta(dir, 61025, "1", "5")?.bestTime, 8000);
    assert.equal(saveGhost(dir, 61025, slower.p, slower.body, 2), false);                       // slower: kept as is
    assert.equal(saveGhost(dir, 61025, fast.p, fast.body, 3), true);                            // faster: replaced
    assert.equal(readFileSync(join(dir, "61025-1-5.ghost"), "utf8"), "fast-ghost!");
    assert.equal(ghostMeta(dir, 61026, "1", "5"), null);                                         // another driver has none
    assert.equal(saveGhost(dir, 61025, { ...fast.p, ghostLength: "5" }, fast.body, 4), false);  // announced length does not match
    assert.equal(saveGhost(dir, 61025, { ...fast.p, bestTime: "0" }, fast.body, 4), false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("ghost download", () => {
  const cfg = { lanIp: "127.0.0.1", publicIp: null, svo: { host: "auto", port: 0, region: { id: 1, mediusLocation: "us" }, eulaFile: "eula.txt", announcementFile: "announcement.txt", eulaAlwaysShow: true },
    dns: { port: 0, upstream: "127.0.0.1", localNames: [], localSuffixes: [] }, web: { port: 0 }, horizon: { crudUrl: "http://127.0.0.1:9", appId: 21624 }, database: ":memory:",
    leaderboards: { timeattackModes: null, speedModes: null }, antiCheat: { ...DEFAULT_ANTICHEAT } } as unknown as Config;
  const store = new Store(":memory:");
  let server: Server;
  let base = "";
  let aliceId = 0;
  const ghost = Buffer.from("pretend this is a 47460 byte ghost");
  before(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { saveGhost } = await import("../src/svo/ghosts.js");
    const dir = mkdtempSync(join(tmpdir(), "mspr-ghost-http-"));
    const a = store.login("Alice", "1"), b = store.login("Bob", "2");
    aliceId = a.account_id;
    const ta = (bestTime: string) => ({ "location.gameMode": "9", "location.track": "1", "location.vehicle": "4", bestTime, endNormal: "1" });
    store.addRace(a.account_id, ta("8048"));
    store.addRace(b.account_id, ta("9000"));
    saveGhost(join(dir, "ghosts"), a.account_id, { ...ta("8048"), ghostLength: String(ghost.length) }, ghost, 1);   // only Alice has a ghost
    server = startSvo(cfg, store, join(dir, "svo_requests.log"));
    await new Promise<void>((done) => server.once("listening", () => done()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => { server.close(); store.close(); });

  test("a Time Attack row says ghostAvailable only for a driver with a stored ghost", async () => {
    const xml = await (await fetch(`${base}/motorstormpr/leaderboard/timeattack?location.region=0&row=0&pageSize=10&location.track=1&location.vehicle=0`)).text();
    assert.match(xml, /accountName="Alice"[^>]*ghostAvailable="1"/);
    assert.match(xml, /accountName="Bob"[^>]*ghostAvailable="0"/);
  });
  test("the download returns the ghost as base64 in <ghost><data>", async () => {
    const xml = await (await fetch(`${base}/motorstormpr/ghost?location.gameMode=9&location.vehicle=4&location.track=1&account=${aliceId}`)).text();
    const m = /<ghost>\s*<data>([^<]*)<\/data>\s*<\/ghost>/.exec(xml);
    assert.ok(m);
    assert.deepEqual(Buffer.from(m![1], "base64"), ghost);
  });
  test("the game asks for it under leaderboard/ghost and gets the ghost, not a leaderboard", async () => {
    const xml = await (await fetch(`${base}/motorstormpr/leaderboard/ghost?location.gameMode=9&location.vehicle=4&location.track=1&account=${aliceId}`)).text();
    assert.match(xml, /<ghost>/);
    assert.doesNotMatch(xml, /<leaderboard>/);
    assert.deepEqual(Buffer.from(/<data>([^<]*)<\/data>/.exec(xml)![1], "base64"), ghost);
  });
  test("another track, vehicle or driver, and malformed numbers, give an empty data element", async () => {
    for (const q of [`location.vehicle=4&location.track=2&account=${aliceId}`, `location.vehicle=5&location.track=1&account=${aliceId}`,
      `location.vehicle=4&location.track=1&account=${aliceId + 1}`, `location.vehicle=4&location.track=1&account=../../etc`, `location.vehicle=4&location.track=1`]) {
      const xml = await (await fetch(`${base}/motorstormpr/ghost?location.gameMode=9&${q}`)).text();
      assert.match(xml, /<data><\/data>/, q);
    }
  });
});

describe("speed-weekend/beaten", () => {
  test("a driver is told who beat their time, until they look at that board again", () => {
    const s = new Store(":memory:");
    const a = s.login("Alice", "1"), b = s.login("Bob", "2");
    const wk = (left: string) => ({ "location.gameMode": "11", "location.track": "14", "location.vehicle": "1", bestTime: left, endNormal: "1" });
    s.addRace(a.account_id, wk("32868"));
    assert.deepEqual(s.weekendBeaten(a.account_id), []);                       // nobody faster yet
    s.db.prepare("UPDATE races SET t = t - 60").run();                           // Alice raced a minute ago
    s.addRace(b.account_id, wk("34874"));                                        // Bob has more time left: better
    const got = s.weekendBeaten(a.account_id);
    assert.deepEqual(got, [{ accountName: "Bob", account: b.account_id, time: 34874, oldTime: 32868, track: "14", vehicle: "1" }]);
    assert.deepEqual(s.weekendBeaten(b.account_id), []);                         // Bob beat everybody
    s.weekendViewed(a.account_id, "14", "1");
    assert.deepEqual(s.weekendBeaten(a.account_id), []);                         // looked at the board: done
    s.addRace(b.account_id, wk("40000"));                                        // Bob improves again later
    s.db.prepare("UPDATE weekend_views SET t = t - 60").run();
    assert.equal(s.weekendBeaten(a.account_id)[0].time, 40000);
  });
  test("the answer has the shape the game's parser reads", async () => {
    const { beatenXml } = await import("../src/svo/protocol.js");
    assert.equal(beatenXml([{ accountName: "B<ob", account: 5, time: 2, oldTime: 1, track: "14", vehicle: "1" }]),
      '<XML>\r\n    <beaten_times>\r\n        <time accountName="B&lt;ob" account="5" time="2" oldTime="1" track="14" vehicle="1"/>\r\n    </beaten_times>\r\n</XML>\r\n');
  });
});

describe("race lists show what the game reports", () => {
  test("placings: against the clock there is no place, a Weekend win is 1st, position 100 is not a placing", async () => {
    const { placeOf } = await import("../src/db/types.js");
    const raw = (o: Record<string, string>) => JSON.stringify(o);
    assert.equal(placeOf(raw({ "location.gameMode": "11", won: "1", position: "1" }), 1), 1);
    assert.equal(placeOf(raw({ "location.gameMode": "11", position: "100" }), 100), null);
    assert.equal(placeOf(raw({ "location.gameMode": "9", position: "2" }), 2), null);
    assert.equal(placeOf(raw({ "location.gameMode": "5", position: "100" }), 100), null);
    assert.equal(placeOf(raw({ "location.gameMode": "4", position: "2" }), 2), 3);          // online races are unchanged
    assert.equal(placeOf(raw({ "location.gameMode": "5", placed1: "1", position: "2" }), 2), 1);
  });
  test("the bookkeeping report after a Weekend race is not listed as a race", () => {
    const s = new Store(":memory:");
    const a = s.login("Alice", "1");
    const wk = { "location.gameMode": "11", "location.track": "14", "location.vehicle": "1", endNormal: "1" };
    s.addRace(a.account_id, { ...wk, bestTime: "34874", totalRaceTime: "57165", position: "1", won: "1", laps: "1" });
    s.addRace(a.account_id, { ...wk, bestTime: "34874", position: "100", laps: "0" });   // no totalRaceTime: the follow-up report
    assert.equal(s.racesFiltered({ limit: 10 }).rows.length, 1);
    assert.equal(s.matches({ limit: 10 }).rows.length, 1);
    assert.equal(s.speedTracks()[0].races, 1);
    assert.equal(s.speedBoard("14", "0").length, 1);                                          // the board still has Alice once
  });
});
