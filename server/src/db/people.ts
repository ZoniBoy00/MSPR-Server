import type { Store } from "./store.js";
import type { Account } from "./types.js";
import { displayName, isRace, placeOf } from "./types.js";
import { racesFiltered, rankedBoard, records } from "./races.js";

// Drivers, driver profiles and track summaries (read-only views over the other tables).

/** Drivers with their activity; `q` filters by name. Sorted by Ranked score, race count, recent activity or name. */
export function drivers(s: Store, f: { q?: string; sort?: string; limit: number; offset?: number }) {
  const like = `%${(f.q ?? "").replace(/[%_]/g, " ").trim()}%`;
  const base = s.q(`
    SELECT a.account_id AS accountId, a.online_id AS name, a.created, a.last_login AS lastLogin,
      (SELECT COUNT(*) FROM races r WHERE r.account_id = a.account_id AND COALESCE(r.track, '') <> '999' AND ${isRace("r.")}) AS races,
      (SELECT MAX(r.t) FROM races r WHERE r.account_id = a.account_id) AS lastRace
    FROM accounts a WHERE a.online_id LIKE ?`).all(like) as
    { accountId: number; name: string; created: number; lastLogin: number; races: number; lastRace: number | null }[];
  const ranked = new Map(rankedBoard(s, ["score", "playersBeaten"]).map((r) => [r.accountId, r]));
  const rows = base.map((r) => {
    const k = ranked.get(r.accountId);
    return { ...r, name: displayName(r.name), rankedRank: k?.rank ?? null, score: k?.stats.score ?? 0, wins: k?.wins ?? 0, active: Math.max(r.lastRace ?? 0, r.lastLogin) };
  });
  const by: Record<string, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
    score: (a, b) => b.score - a.score || b.races - a.races || a.name.localeCompare(b.name),
    races: (a, b) => b.races - a.races || a.name.localeCompare(b.name),
    recent: (a, b) => b.active - a.active,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  rows.sort(by[f.sort ?? "score"] ?? by.score);
  return { total: rows.length, rows: rows.slice(f.offset ?? 0, (f.offset ?? 0) + f.limit) };
}

/** Per-player summary: race counts by mode, Ranked totals, Time Attack personal bests and the latest races. */
export function playerProfile(s: Store, acc: Account) {
  const byMode = s.q(`
    SELECT game_mode AS mode, COUNT(*) AS races,
           SUM(COALESCE(CAST(json_extract(raw, '$.won') AS INTEGER), 0)) AS wins
    FROM races WHERE account_id = ? AND COALESCE(track, '') <> '999' AND ${isRace()} GROUP BY game_mode ORDER BY races DESC`).all(acc.account_id);
  const bests = s.q(`
    SELECT track, vehicle, MIN(best_time) AS bestTime FROM races
    WHERE account_id = ? AND best_time > 0 AND COALESCE(end_normal, 1) <> 0 AND ${s.notFlagged()}
      AND game_mode = '9' AND COALESCE(track, '') <> '999'
    GROUP BY track ORDER BY CAST(track AS INTEGER)`).all(acc.account_id);
  const ranked = rankedBoard(s, ["score", "playersBeaten"]).find((r) => r.accountId === acc.account_id) ?? null;
  const recent = racesFiltered(s, { limit: 10, accountId: acc.account_id }).rows;
  // the game reports its total XP after every race, so `score` is already the running total (the data behind the profile's progress chart)
  const scored = s.q(`
    SELECT t, CAST(json_extract(raw, '$.score') AS INTEGER) AS score FROM races
    WHERE account_id = ? AND json_extract(raw, '$.score') IS NOT NULL AND ${s.notFlagged()} AND COALESCE(end_normal, 1) = 1 ORDER BY id`)
    .all(acc.account_id) as { t: number; score: number }[];
  let prev = 0;
  const scoreHistory = scored.map((s) => { const change = s.score - prev; prev = s.score; return { t: s.t, score: s.score, change, total: s.score }; });
  return {
    accountId: acc.account_id, name: displayName(acc.online_id), created: acc.created, lastLogin: acc.last_login,
    byMode, ranked, timeAttackBests: bests, scoreHistory, recent,
  };
}

/** Per track: how often it was raced, by how many drivers and in which modes and vehicles, and the Time Attack record. */
export function trackSummaries(s: Store) {
  const where = `track IS NOT NULL AND track <> '999' AND ${isRace()}`;
  const base = s.q(`SELECT track, COUNT(*) AS races, COUNT(DISTINCT account_id) AS drivers, MAX(t) AS lastRace FROM races WHERE ${where} GROUP BY track`).all() as
    { track: string; races: number; drivers: number; lastRace: number }[];
  const vehicles = s.q(`SELECT track, vehicle, COUNT(*) AS n FROM races WHERE ${where} AND vehicle IS NOT NULL GROUP BY track, vehicle ORDER BY n DESC`).all() as
    { track: string; vehicle: string; n: number }[];
  const modes = s.q(`SELECT track, game_mode AS mode, COUNT(*) AS n FROM races WHERE ${where} GROUP BY track, game_mode`).all() as { track: string; mode: string; n: number }[];
  const allRecords = records(s);
  return base.map((t) => {
    const rec = allRecords.filter((r) => r.track === t.track).sort((a, b) => a.bestTime - b.bestTime)[0] ?? null;
    return {
      ...t,
      vehicles: vehicles.filter((v) => v.track === t.track).map((v) => ({ vehicle: v.vehicle, races: v.n })),
      modes: modes.filter((m) => m.track === t.track).map((m) => ({ mode: m.mode, races: m.n })),
      record: rec,
      records: allRecords.filter((r) => r.track === t.track),
    };
  }).sort((a, b) => Number(a.track) - Number(b.track));
}
