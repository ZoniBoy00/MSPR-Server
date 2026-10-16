import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Store, placeOf } from "../src/db/store.js";

/** A finishGame form as the game sends it, reduced to the fields the stats code reads. */
const race = (over: Record<string, string>): Record<string, string> => ({
  "location.gameMode": "5", "location.track": "17", "location.vehicle": "2", endNormal: "1", bestTime: "187326", totalRaceTime: "187110", ...over,
});

describe("finishing place", () => {
  test("placedN flag wins over position", () => {
    assert.equal(placeOf(JSON.stringify({ placed2: "1", position: "2" }), 2), 2);
    assert.equal(placeOf(JSON.stringify({ placed1: "1", position: "2" }), 2), 1);
  });
  test("playersBeatenBy is used when no placedN flag is present", () => {
    assert.equal(placeOf(JSON.stringify({ playersBeatenBy: "0" }), 5), 1);
    assert.equal(placeOf(JSON.stringify({ playersBeatenBy: "3" }), 0), 4);
  });
  test("falls back to the 0-based position, and to null without one", () => {
    assert.equal(placeOf(JSON.stringify({}), 0), 1);
    assert.equal(placeOf("not json", 2), 3);
    assert.equal(placeOf(null, null), null);
  });
});

describe("ranked standings, records and summaries", () => {
  const s = new Store(":memory:");
  const a = s.login("Alice", "1"), b = s.login("Bob", "2");
  s.addRace(a.account_id, race({ score: "101", playersBeaten: "1", won: "1", placed1: "1" }));
  s.addRace(a.account_id, race({ score: "51", playersBeaten: "1", won: "1", placed1: "1", "location.track": "2" }));
  s.addRace(b.account_id, race({ score: "2", playersBeaten: "0", placed2: "1", vehicle: "3" }));
  s.addRace(a.account_id, race({ "location.gameMode": "9", "location.track": "1", "location.vehicle": "4", bestTime: "8048" }));
  s.addRace(b.account_id, race({ "location.gameMode": "9", "location.track": "1", "location.vehicle": "4", bestTime: "9000" }));
  s.addRace(a.account_id, race({ score: "999", placed1: "1" }), "cheating");

  test("ranked board: score is the latest total XP, other stats are summed, flagged races are skipped", () => {
    const rows = s.rankedBoard(["score", "playersBeaten"]);
    assert.deepEqual(rows.map((r) => [r.rank, r.accountName, r.stats.score, r.stats.playersBeaten, r.wins, r.races]),
      [[1, "Alice", 51, 2, 2, 2], [2, "Bob", 2, 0, 0, 1]]);
  });
  test("stat names that are not plain words are ignored", () => {
    const rows = s.rankedBoard(["score", "x') OR 1=1 --"]);
    assert.deepEqual(Object.keys(rows[0].stats), ["score"]);
  });
  test("online races stay off the Time Attack board, offline ones are listed", () => {
    assert.equal(s.board("17", "0", null).length, 0);
    assert.deepEqual(s.board("1", "0", null).map((r) => [r.accountName, r.bestTime]), [["Alice", 8048], ["Bob", 9000]]);
  });
  test("records are the best lap per track and vehicle", () => {
    const rec = s.records();
    assert.equal(rec.length, 1);
    assert.deepEqual([rec[0].track, rec[0].vehicle, rec[0].accountName, rec[0].bestTime], ["1", "4", "Alice", 8048]);
  });
  test("filtered races page and count", () => {
    const all = s.racesFiltered({ limit: 2 });
    assert.equal(all.total, 6);
    assert.equal(all.rows.length, 2);
    const ranked = s.racesFiltered({ limit: 50, mode: "5", accountId: b.account_id });
    assert.equal(ranked.total, 1);
    assert.equal(ranked.rows[0].place, 2);
  });
  test("driver profile and lookup by name", () => {
    assert.equal(s.accountByName("alice")?.account_id, a.account_id);
    assert.equal(s.accountByName("nobody"), undefined);
    const p = s.playerProfile(a);
    assert.equal(p.ranked?.rank, 1);
    assert.equal(p.timeAttackBests.length, 1);
    assert.ok(p.byMode.some((m) => m.mode === "5" && Number(m.wins) === 2));
  });
  test("summary counts races per mode", () => {
    const sum = s.summary();
    assert.equal(sum.byMode.reduce((n, m) => n + Number(m.races), 0), 6);
    assert.equal(sum.topDrivers[0].name, "Alice");
  });
});

describe("matches", () => {
  const s = new Store(":memory:");
  const a = s.login("Alice", "1"), b = s.login("Bob", "2"), c = s.login("Cara", "3");
  const report = (over: Record<string, string>) => ({ "location.gameMode": "5", "location.track": "17", gameId: "2", laps: "2", endNormal: "1", totalRaceTime: "187110", bestTime: "187326", ...over });
  s.addRace(a.account_id, report({ placed1: "1", won: "1", score: "101" }));
  s.addRace(b.account_id, report({ placed2: "1", totalRaceTime: "216883" }));
  s.addRace(c.account_id, report({ gameId: "3", placed1: "1" }));                    // another game on the same track
  s.addRace(a.account_id, { "location.gameMode": "9", "location.track": "1", bestTime: "8048", endNormal: "1" });   // single player

  test("reports of the same game are one race, other games and single-player runs are their own", () => {
    const { total, rows } = s.matches({ limit: 10 });
    assert.equal(total, 3);
    const ranked = rows.filter((m) => m.mode === "5");
    assert.equal(ranked.length, 2);
    const two = ranked.find((m) => m.players.length === 2)!;
    assert.deepEqual(two.players.map((p) => [p.place, p.name]), [[1, "Alice"], [2, "Bob"]]);
    assert.equal(two.players[0].won, true);
    assert.equal(two.players[0].laps, 2);
  });
  test("a race keeps its id and can be fetched on its own", () => {
    const m = s.matches({ limit: 10 }).rows.find((x) => x.players.length === 2)!;
    assert.equal(s.match(m.id)?.players.length, 2);
    assert.equal(s.match(9999), undefined);
  });
  test("filters by mode and by driver", () => {
    assert.equal(s.matches({ limit: 10, mode: "9" }).total, 1);
    assert.equal(s.matches({ limit: 10, accountId: b.account_id }).total, 1);
    assert.equal(s.matches({ limit: 1, offset: 1 }).rows.length, 1);
  });
});

describe("match grouping cache", () => {
  const s = new Store(":memory:");
  const a = s.login("Alice", "1"), b = s.login("Bob", "2");
  const rep = (over: Record<string, string> = {}) => ({ "location.gameMode": "5", "location.track": "17", gameId: "2", endNormal: "1", ...over });

  test("a new race shows up at once and ids of earlier races stay the same", () => {
    s.addRace(a.account_id, rep({ placed1: "1" }));
    const first = s.matches({ limit: 10 });
    assert.equal(first.total, 1);
    assert.equal(s.matches({ limit: 10 }).total, 1);                 // served from the cache
    s.addRace(b.account_id, rep({ placed2: "1" }));                  // joins the same race
    const second = s.matches({ limit: 10 });
    assert.equal(second.total, 1);
    assert.equal(second.rows[0].id, first.rows[0].id);
    assert.equal(second.rows[0].players.length, 2);
    s.addRace(a.account_id, rep({ gameId: "9" }));                   // another game
    assert.equal(s.matches({ limit: 10 }).total, 2);
  });
  test("listing does not reorder the cached grouping", () => {
    const newestFirst = s.matches({ limit: 10 }).rows.map((m) => m.id);
    assert.deepEqual(newestFirst, [...newestFirst].sort((x, y) => y - x));
    assert.ok(s.match(newestFirst[1]));                              // lookups still work after a sorted listing
  });
});

describe("race numbers", () => {
  test("races are numbered 1, 2, 3 in the order they were reported, whatever the report ids are", () => {
    const s = new Store(":memory:");
    const a = s.login("Alice", "1"), b = s.login("Bob", "2");
    const rep = (gameId: string, over: Record<string, string> = {}) => ({ "location.gameMode": "5", "location.track": "17", gameId, endNormal: "1", ...over });
    s.addRace(a.account_id, rep("1", { placed1: "1" }));      // report 1 -> race 1
    s.addRace(b.account_id, rep("1", { placed2: "1" }));      // report 2 joins race 1
    s.addRace(a.account_id, rep("2", { placed1: "1" }));      // report 3 -> race 2
    s.addRace(b.account_id, rep("2", { placed2: "1" }));      // report 4 joins race 2
    s.addRace(a.account_id, rep("3", { placed1: "1" }));      // report 5 -> race 3
    assert.deepEqual(s.matches({ limit: 10 }).rows.map((m) => m.id), [3, 2, 1]);
    assert.equal(s.match(2)?.players.length, 2);
  });
});

describe("activity summary", () => {
  test("counts races, not the reports of their drivers", () => {
    const s = new Store(":memory:");
    const a = s.login("Alice", "1"), b = s.login("Bob", "2");
    const rep = (gameId: string, over: Record<string, string> = {}) => ({ "location.gameMode": "5", "location.track": "17", gameId, endNormal: "1", ...over });
    s.addRace(a.account_id, rep("1")); s.addRace(b.account_id, rep("1"));                 // one race, two reports
    s.addRace(a.account_id, rep("2")); s.addRace(b.account_id, rep("2"));                 // another race
    s.addRace(a.account_id, { "location.gameMode": "9", "location.track": "1", endNormal: "1" });   // a Time Attack run
    const sum = s.summary();
    assert.deepEqual(sum.byMode, [{ mode: "5", races: 2 }, { mode: "9", races: 1 }]);
    assert.equal(sum.perDay.reduce((n, d) => n + Number(d.races), 0), 3);
    assert.equal(sum.perDayByMode.reduce((n, d) => n + Number(d.races), 0), 3);
    assert.deepEqual(sum.topTracks, [{ track: "17", races: 2 }, { track: "1", races: 1 }]);
    assert.equal(sum.topDrivers[0].races, 3);                                              // Alice took part in three races
  });
});

describe("ranked XP rules", () => {
  test("levels and tiers follow the game's table", async () => {
    const { levelOf, rankOf, points, expectedXp } = await import("../src/online/rank.js");
    assert.deepEqual([1, 99, 100, 101, 2500, 75000, 80000].map(levelOf), [1, 1, 2, 2, 10, 50, 50]);
    assert.deepEqual([1, 10, 11, 50].map(rankOf), [1, 1, 2, 5]);
    assert.deepEqual(points(0), { won: 50, lost: -50 });
    assert.deepEqual(points(1), { won: 46, lost: -54 });
    assert.deepEqual(points(99), points(50));
  });
  test("expected XP reproduces the real races of the live server (1 -> 51 -> 101 -> 147, loser stays at 1)", async () => {
    const { expectedXp } = await import("../src/online/rank.js");
    assert.equal(expectedXp(1, [{ level: 1, beaten: true }]), 51);
    assert.equal(expectedXp(51, [{ level: 1, beaten: true }]), 101);
    assert.equal(expectedXp(101, [{ level: 1, beaten: true }]), 147);
    assert.equal(expectedXp(1, [{ level: 1, beaten: false }]), 1);
  });
});
