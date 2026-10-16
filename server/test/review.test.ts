import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Store } from "../src/db/store.js";
import { OnlineTracker, reviewStored } from "../src/online/integrity.js";
import { MAX_SPEED_MS, impossibleReport, reviewMatch, reviewReport, reviewXp, statsRollback } from "../src/svo/review.js";
import type { Config } from "../src/config.js";

describe("single reports", () => {
  test("time in first place cannot exceed the race", () => {
    assert.match(impossibleReport({ totalRaceTime: "100000", totalRaceTimeInFirst: "150000" })!, /longer than the race/);
    assert.equal(impossibleReport({ totalRaceTime: "187110", totalRaceTimeInFirst: "186510" }), null);
    assert.equal(impossibleReport({}), null);
  });
  test("an impossible average speed is a finding, a normal race is not", () => {
    const real = { "location.gameMode": "5", totalRaceTime: "187110", distanceTravelled: "6726335" };   // 36 m/s
    assert.deepEqual(reviewReport(real), []);
    const fake = { "location.gameMode": "5", totalRaceTime: "60000", distanceTravelled: String(MAX_SPEED_MS * 60000 + 1000000) };
    assert.equal(reviewReport(fake)[0].kind, "speed");
  });
  test("a reported win with another place is a finding", () => {
    assert.equal(reviewReport({ "location.gameMode": "5", won: "1", placed2: "1" })[0].kind, "won-mismatch");
    assert.deepEqual(reviewReport({ "location.gameMode": "5", won: "1", placed1: "1" }), []);
    // a Weekend race is run against the clock: "won" says nothing about a place
    assert.deepEqual(reviewReport({ "location.gameMode": "11", won: "1", position: "1" }), []);
  });
});

describe("reports of one race", () => {
  const e = (accountId: number, name: string, place: number, totalTime: number) => ({ accountId, name, place, totalTime, finished: true, won: place === 1 });
  test("consistent reports give no findings", () => {
    assert.deepEqual(reviewMatch([e(1, "A", 1, 187110), e(2, "B", 2, 216883)]), []);
  });
  test("a better place with a slower time is attributed to the driver who claims it", () => {
    const f = reviewMatch([e(1, "A", 1, 250000), e(2, "B", 2, 216883)]);
    assert.equal(f.length, 1);
    assert.equal(f[0].accountId, 1);
    assert.equal(f[0].kind, "place-vs-time");
  });
  test("two winners", () => {
    assert.equal(reviewMatch([e(1, "A", 1, 100000), e(2, "B", 1, 100100)]).filter((x) => x.kind === "two-winners").length, 2);
  });
});

describe("stats blob", () => {
  const blob = (races: number, best: number) => { const b = Buffer.alloc(256); b.writeUInt32BE(best, 8); b.writeUInt32BE(races, 72); return b; };
  test("counters that go backwards are found, growth is not", () => {
    assert.deepEqual(statsRollback(blob(3, 100), blob(4, 100)), []);
    assert.deepEqual(statsRollback(null, blob(0, 0)), []);
    assert.deepEqual(statsRollback(blob(5, 101), blob(5, 51)), []);               // XP (offset 8) falls after a loss
    const f = statsRollback(blob(5, 101), blob(2, 51));
    assert.deepEqual(f.map((x) => x.detail), ["races went from 5 to 2"]);
  });
  test("the store records the rollback as a finding", () => {
    const s = new Store(":memory:");
    const a = s.login("Alice", "1");
    assert.ok(s.setMediusStats(a.account_id, blob(5, 101).toString("base64")));
    assert.ok(s.setMediusStats(a.account_id, blob(2, 51).toString("base64")));
    assert.equal(s.anticheatOverview().findings.length, 1);
  });
});

describe("wall clock", () => {
  const cfg = { horizon: { crudUrl: "http://127.0.0.1:1" } } as unknown as Config;
  const game = [{ worldId: 2, type: "ranked", players: [{ name: "Alice@RPCN" }, { name: "Bob@RPCN" }] }];
  const report = (ms: number) => ({ "location.gameMode": "5", totalRaceTime: String(ms) });

  test("a race cannot last longer than the driver has been in the game", () => {
    const t = new OnlineTracker(cfg);
    const t0 = Date.now() + 10 * 60_000;                // well after the tracker started
    t.record(game, t0);
    assert.equal(t.checkTiming("Alice", report(187110), t0 + 200_000), null);
    assert.match(t.checkTiming("Alice", report(187110), t0 + 90_000)!, /longer than the/);
  });
  test("a driver first seen right after a restart is not judged", () => {
    const t = new OnlineTracker(cfg);
    t.record(game, Date.now() + 1000);
    assert.equal(t.checkTiming("Alice", report(187110), Date.now() + 5000), null);
  });
});

describe("findings of a stored race, tracks and drivers", () => {
  const s = new Store(":memory:");
  const a = s.login("Alice", "1"), b = s.login("Bob", "2");
  const rep = (over: Record<string, string>) => ({ "location.gameMode": "5", "location.track": "17", "location.vehicle": "2", gameId: "2", laps: "2", endNormal: "1", bestTime: "100", ...over });
  const ra = s.addRace(a.account_id, rep({ placed1: "1", totalRaceTime: "250000", score: "50" }));
  reviewStored(s, ra, a.account_id, rep({ placed1: "1", totalRaceTime: "250000" }));
  const rb = s.addRace(b.account_id, rep({ placed2: "1", totalRaceTime: "216883", score: "1" }));
  reviewStored(s, rb, b.account_id, rep({ placed2: "1", totalRaceTime: "216883" }));
  s.addRace(a.account_id, { "location.gameMode": "9", "location.track": "1", "location.vehicle": "4", bestTime: "8048", endNormal: "1" });
  s.addRace(b.account_id, rep({ placed1: "1", totalRaceTime: "1" }), "test rejection");

  test("the cross-check finding is stored once, with the race it came from", () => {
    reviewStored(s, rb, b.account_id, rep({ placed2: "1", totalRaceTime: "216883" }));      // same report again: no duplicate
    const o = s.anticheatOverview();
    assert.equal(o.findings.filter((f) => f.kind === "place-vs-time").length, 1);
    assert.equal(o.findings[0].name, "Alice");
    assert.equal(o.counts.rejectedTotal, 1);
    assert.equal(o.rejected[0].reason, "test rejection");
  });
  test("drivers can be searched and sorted", () => {
    assert.deepEqual(s.drivers({ limit: 10, q: "ali" }).rows.map((r) => r.name), ["Alice"]);
    assert.equal(s.drivers({ limit: 10, sort: "races" }).total, 2);
    assert.equal(s.drivers({ limit: 10 }).rows[0].name, "Alice");                            // higher Ranked score
  });
  test("track summaries list races, vehicles, modes and the Time Attack record", () => {
    const t = s.trackSummaries();
    assert.deepEqual(t.map((x) => x.track), ["1", "17"]);
    assert.equal(t[0].record?.bestTime, 8048);
    assert.equal(t[1].races, 3);
    assert.equal(t[1].drivers, 2);
    assert.equal(t[1].record, null);
  });
});

describe("false positives", () => {
  test("a race the driver quit is neither rejected nor a strike", async () => {
    const { checkRace, DEFAULT_ANTICHEAT } = await import("../src/svo/anticheat.js");
    assert.equal(checkRace({ "location.track": "17", endNormal: "0", bestTime: "0" }, 0, DEFAULT_ANTICHEAT), null);
    assert.match(checkRace({ "location.track": "17", endNormal: "1", bestTime: "0" }, 0, DEFAULT_ANTICHEAT)!, /bestTime/);
    // a Time Attack run that ended before the first lap was done has no best time at all: not counted, but not a strike
    const noLap = { "location.gameMode": "9", "location.track": "6", "location.vehicle": "5", endNormal: "1", laps: "2", totalRaceTime: "137081" };
    assert.equal(checkRace(noLap, 0, DEFAULT_ANTICHEAT), null);
    assert.match(checkRace({ ...noLap, bestTime: "0" }, 0, DEFAULT_ANTICHEAT)!, /bestTime/);          // a zero is still wrong
    assert.match(checkRace({ ...noLap, "location.gameMode": "5" }, 0, DEFAULT_ANTICHEAT)!, /bestTime/);   // other modes are still judged
  });
  test("the wall clock allows a minute of slack", () => {
    const cfg = { horizon: { crudUrl: "http://127.0.0.1:1" } } as unknown as Config;
    const t = new OnlineTracker(cfg);
    const t0 = Date.now() + 10 * 60_000;
    t.record([{ worldId: 2, type: "ranked", players: [{ name: "Alice@RPCN" }] }], t0);
    const report = { "location.gameMode": "5", totalRaceTime: "187110" };
    assert.equal(t.checkTiming("Alice", report, t0 + 130_000), null);                    // 57 s short: tolerated
    assert.notEqual(t.checkTiming("Alice", report, t0 + 100_000), null);                 // 87 s short: not
  });
});

describe("XP against the game's rules", () => {
  const e = (accountId: number, place: number, score: number) => ({ accountId, name: `P${accountId}`, place, score, finished: true as boolean | null, flagged: null as string | null });
  test("the real races of the live server fit (1 -> 51 -> 101 -> 147, the loser stays at 1)", () => {
    assert.deepEqual(reviewXp([e(1, 1, 51), e(2, 2, 1)], new Map([[1, 1], [2, 1]])), []);
    assert.deepEqual(reviewXp([e(1, 1, 101), e(2, 2, 1)], new Map([[1, 51], [2, 1]])), []);
    assert.deepEqual(reviewXp([e(1, 1, 147), e(2, 2, 1)], new Map([[1, 101], [2, 1]])), []);
  });
  test("a bigger gain than the rules allow is a finding; an unknown driver or opponent is not judged", () => {
    const f = reviewXp([e(1, 1, 400), e(2, 2, 1)], new Map([[1, 1], [2, 1]]));
    assert.equal(f.length, 1);
    assert.equal(f[0].kind, "xp-mismatch");
    assert.equal(f[0].accountId, 1);
    assert.deepEqual(reviewXp([e(1, 1, 400), e(2, 2, 1)], new Map([[2, 1]])), []);          // the driver has no earlier race
    assert.deepEqual(reviewXp([e(1, 1, 400), e(2, 2, 1)], new Map([[1, 1]])), []);          // the opponent has none
  });
  test("an unchanged XP after a loss (rank-up immunity) is accepted", () => {
    assert.deepEqual(reviewXp([e(1, 2, 150), e(2, 1, 55)], new Map([[1, 150], [2, 1]])), []);
  });
  test("the store feeds the check: a wrong XP in a stored Ranked race is recorded", () => {
    const st = new Store(":memory:");
    const a = st.login("Alice", "1"), b = st.login("Bob", "2");
    const rep = (gameId: string, over: Record<string, string>) => ({ "location.gameMode": "5", "location.track": "17", "location.vehicle": "2", gameId, laps: "2", endNormal: "1", bestTime: "100", totalRaceTime: "200000", ...over });
    const go = (gid: string, sa: string, sb: string) => {
      const ra = st.addRace(a.account_id, rep(gid, { placed1: "1", score: sa }));
      reviewStored(st, ra, a.account_id, rep(gid, { placed1: "1", score: sa }));
      const rb = st.addRace(b.account_id, rep(gid, { placed2: "1", score: sb }));
      reviewStored(st, rb, b.account_id, rep(gid, { placed2: "1", score: sb }));
    };
    go("1", "51", "1");
    go("2", "101", "1");
    assert.equal(st.anticheatOverview().findings.filter((x) => x.kind === "xp-mismatch").length, 0);
    go("3", "900", "1");
    assert.equal(st.anticheatOverview().findings.filter((x) => x.kind === "xp-mismatch").length, 1);
  });
});
