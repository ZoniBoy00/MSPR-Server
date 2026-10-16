import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_ANTICHEAT } from "../src/svo/anticheat.js";
import type { Config } from "../src/config.js";
import { OnlineTracker } from "../src/online/integrity.js";
import { Diagnostics, platformOf, platformOfKey } from "../src/ops/diagnostics.js";

const cfg = { horizon: { crudUrl: "http://127.0.0.1:9", appId: 21624 }, antiCheat: { ...DEFAULT_ANTICHEAT } } as unknown as Config;
const game = (names: string[], extra: Record<string, unknown> = {}) =>
  ({ worldId: 3, type: "casual", name: "000001ac-PsnPlayerOne", host: "PsnPlayerOne", track: 29, createdUtc: "2026-10-15T13:17:34Z", players: names.map((name) => ({ name, inGame: true })), ...extra });

describe("event journal", () => {
  test("keeps the newest events, filters by kind and never throws", () => {
    const d = new Diagnostics(undefined, false, 3);
    for (let i = 0; i < 5; i++) d.event(i % 2 ? "login" : "game.join", `e${i}`, undefined, "info", i);
    assert.deepEqual(d.list().map((e) => e.msg), ["e4", "e3", "e2"]);                 // newest first, capped at 3
    assert.deepEqual(d.list({ kind: "login" }).map((e) => e.msg), ["e3"]);
    assert.deepEqual(d.list({ kind: "game" }).map((e) => e.msg), ["e4", "e2"]);        // a prefix matches game.join, game.leave ...
  });
  test("tells a real PS3 from RPCS3", () => {
    assert.equal(platformOf("PsnPlayerOne"), "PS3 (PSN)");
    assert.equal(platformOf("ZoniBoy0@RPCN"), "RPCS3 (RPCN)");
    assert.equal(platformOfKey("PsnPlayerOne@PSN"), "PS3 (PSN)");
    assert.equal(platformOfKey("ZoniBoy0"), "RPCS3 (RPCN)");
  });
});

describe("game summaries", () => {
  const T0 = 1_000_000;
  function run(posters: string[], seconds = 240) {
    const d = new Diagnostics(undefined, false);
    const t = new OnlineTracker(cfg, d);
    const all = ["ZoniBoy0@RPCN", "RpcnPlayerTwo@RPCN", "PsnPlayerOne"];
    t.record([game(all.slice(0, 1))], T0);
    t.record([game(all)], T0 + 5_000);
    t.record([game(all)], T0 + seconds * 1000);
    for (const who of posters) t.noteResult(who, { "location.gameMode": "6", gameId: "3" }, null, T0 + seconds * 1000 - 5_000);
    t.record([], T0 + (seconds + 5) * 1000);                        // the game disappears
    t.flush(T0 + (seconds + 40) * 1000);                            // and its summary is written after the grace period
    return d;
  }
  test("records the game starting, players joining and the game ending", () => {
    const kinds = run(["ZoniBoy0", "RpcnPlayerTwo", "PsnPlayerOne@PSN"]).list().map((e) => e.kind).reverse();
    assert.equal(kinds.filter((k) => k === "game.start").length, 1);
    assert.equal(kinds.filter((k) => k === "game.join").length, 3);
    assert.ok(kinds.includes("game.end"));
    assert.equal(kinds.filter((k) => k === "game.summary").length, 1);
  });
  test("a race where everybody posted is fine", () => {
    const s = run(["ZoniBoy0", "RpcnPlayerTwo", "PsnPlayerOne@PSN"]).list({ kind: "game.summary" })[0];
    assert.equal(s.level, "info");
    assert.match(s.msg, /everyone posted a result/);
  });
  test("names the players whose result never arrived and warns", () => {
    const s = run(["ZoniBoy0"]).list({ kind: "game.summary" })[0];
    assert.equal(s.level, "warn");
    assert.match(s.msg, /NO RESULT from RpcnPlayerTwo, PsnPlayerOne/);
    const data = s.data as { missing: string[]; players: { name: string; platform: string; resultPosted: boolean }[] };
    assert.deepEqual(data.missing, ["RpcnPlayerTwo@RPCN", "PsnPlayerOne"]);
    assert.equal(data.players.find((p) => p.name === "PsnPlayerOne")!.platform, "PS3 (PSN)");
    assert.equal(data.players.find((p) => p.name === "ZoniBoy0@RPCN")!.resultPosted, true);
  });
  test("a result of another mode does not count", () => {
    const d = new Diagnostics(undefined, false);
    const t = new OnlineTracker(cfg, d);
    t.record([game(["A@RPCN", "B@RPCN"])], T0);
    t.record([game(["A@RPCN", "B@RPCN"])], T0 + 200_000);
    t.noteResult("A", { "location.gameMode": "9" }, null, T0 + 190_000);          // Time Attack, not Casual
    t.noteResult("B", { "location.gameMode": "6" }, null, T0 + 190_000);
    t.record([], T0 + 205_000);
    t.flush(T0 + 240_000);
    assert.deepEqual((d.list({ kind: "game.summary" })[0].data as { missing: string[] }).missing, ["A@RPCN"]);
  });
  test("a short lobby is not judged as a race", () => {
    const d = new Diagnostics(undefined, false);
    const t = new OnlineTracker(cfg, d);
    t.record([game(["A@RPCN", "B@RPCN"])], T0);
    t.record([], T0 + 30_000);
    t.flush(T0 + 80_000);
    const s = d.list({ kind: "game.summary" })[0];
    assert.equal(s.level, "info");
    assert.match(s.msg, /too short to be a race/);
  });
  test("a player who leaves is recorded with the time spent in the game", () => {
    const d = new Diagnostics(undefined, false);
    const t = new OnlineTracker(cfg, d);
    t.record([game(["A@RPCN", "B@RPCN"])], T0);
    t.record([game(["A@RPCN"])], T0 + 61_000);
    const leave = d.list({ kind: "game.leave" })[0];
    assert.equal((leave.data as { seconds: number }).seconds, 61);
    assert.match(leave.msg, /B left casual game/);
  });
});
