import type { Store } from "./store.js";
import { matchClusters } from "./matches.js";
import { displayName, isRace, placeOf } from "./types.js";
import type { BoardRow, RankedRow, SpeedRow } from "./types.js";
import { levelOf, rankOf } from "../online/rank.js";

// Finished races: storing a report, the Time Attack boards, Ranked standings, records and activity summaries.

/** Races an account reported during the last `seconds` (anti-cheat rate check). */
export function recentRaceCount(s: Store, accountId: number, seconds = 60): number {
  return (s.q("SELECT COUNT(*) AS n FROM races WHERE account_id = ? AND t >= ?")
    .get(accountId, Math.floor(Date.now() / 1000) - seconds) as { n: number }).n;
}

export function addRace(s: Store, accountId: number, p: Record<string, string>, flagged: string | null = null): number {
  const num = (k: string) => (p[k] !== undefined && p[k] !== "" ? Number(p[k]) : null);
  const id = s.q(`INSERT INTO races (t, account_id, game_mode, track, vehicle, position, best_time, total_time, end_normal, wrecks, raw, flagged)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(Math.floor(Date.now() / 1000), accountId, p["location.gameMode"] ?? null, p["location.track"] ?? null,
      p["location.vehicle"] ?? null, num("position"), num("bestTime"), num("totalRaceTime"), num("endNormal"),
      num("wrecks"), JSON.stringify(p), flagged).lastInsertRowid as number;
  s.raceVersion++;
  return id;
}

/** Best time per player on a track (vehicle "0" = any vehicle), ascending. */
export function board(s: Store, track: string, vehicle: string, modes: string[] | null, onlyAccounts?: number[]): BoardRow[] {
  const where = ["r.track = ?", "r.best_time > 0", "COALESCE(r.end_normal, 1) <> 0", s.notFlagged("r.")];
  const args: (string | number)[] = [track];
  if (vehicle && vehicle !== "0") { where.push("r.vehicle = ?"); args.push(vehicle); }
  if (modes?.length) { where.push(`r.game_mode IN (${modes.map(() => "?").join(",")})`); args.push(...modes); }
  else where.push("r.game_mode = '9'");                        // Time Attack only: other modes report other things in `bestTime`
  if (onlyAccounts?.length) { where.push(`r.account_id IN (${onlyAccounts.map(() => "?").join(",")})`); args.push(...onlyAccounts); }
  const rows = s.q(`
    SELECT r.account_id AS accountId, a.online_id AS accountName, MIN(r.best_time) AS bestTime, r.vehicle AS vehicle
    FROM races r JOIN accounts a ON a.account_id = r.account_id
    WHERE ${where.join(" AND ")}
    GROUP BY r.account_id ORDER BY bestTime ASC`).all(...args) as Omit<BoardRow, "rank">[];   // SQLite: with a single MIN() the bare column r.vehicle is the one of the fastest row
  return rows.map((r, i) => ({ ...r, accountName: displayName(r.accountName), vehicle: String(r.vehicle ?? "0"), rank: i + 1 }));
}

/**
 * Ranked board: per player the stats of the clean Ranked races, highest score first. `score` is the player's total XP
 * after the race (the game computes it itself, see docs/research/ranked-xp.md), so the board shows the value of the
 * player's latest race that reported one; every other stat (playersBeaten, ...) is summed over the races.
 * Stat names are the `stat.*` query keys of the game's request.
 */
export function rankedBoard(s: Store, stats: string[]): RankedRow[] {
  const keys = stats.filter((k) => /^[A-Za-z]{1,32}$/.test(k));
  if (!keys.includes("score")) keys.unshift("score");
  const clean = `r2.account_id = r.account_id AND r2.game_mode = '5' AND COALESCE(r2.end_normal, 1) = 1 AND ${s.notFlagged("r2.")} AND COALESCE(r2.track, '') <> '999'`;
  const sums = keys.map((k, i) => k === "score"
    ? `COALESCE((SELECT CAST(json_extract(r2.raw, ?) AS INTEGER) FROM races r2 WHERE ${clean} AND json_extract(r2.raw, ?) IS NOT NULL ORDER BY r2.id DESC LIMIT 1), 0) AS s${i}`
    : `SUM(COALESCE(CAST(json_extract(r.raw, ?) AS INTEGER), 0)) AS s${i}`).join(", ");
  const rows = s.q(`
    SELECT r.account_id AS accountId, a.online_id AS accountName, COUNT(*) AS n,
           SUM(COALESCE(CAST(json_extract(r.raw, '$.won') AS INTEGER), 0)) AS wins, ${sums}
    FROM races r JOIN accounts a ON a.account_id = r.account_id
    WHERE r.game_mode = '5' AND COALESCE(r.end_normal, 1) = 1 AND ${s.notFlagged("r.")}
      AND COALESCE(r.track, '') <> '999'
    GROUP BY r.account_id ORDER BY s${keys.indexOf("score")} DESC, a.online_id ASC`)
    .all(...keys.flatMap((k) => (k === "score" ? [`$.${k}`, `$.${k}`] : [`$.${k}`]))) as Record<string, number | string>[];
  return rows.map((r, i) => {
    const stats = Object.fromEntries(keys.map((k, j) => [k, Number(r[`s${j}`])]));
    const level = levelOf(stats.score);
    return { accountId: Number(r.accountId), accountName: displayName(String(r.accountName)), rank: i + 1,
      races: Number(r.n), wins: Number(r.wins), level, rankTier: rankOf(level), stats };
  });
}

/** Finished races with optional filters, newest first, plus the unpaged total. Online modes: 4 custom, 5 ranked, 6 casual. */
export function racesFiltered(s: Store, f: { limit: number; offset?: number; mode?: string; track?: string; vehicle?: string; accountId?: number }) {
  const where = ["COALESCE(r.track, '') <> '999'", isRace("r.")];
  const args: (string | number)[] = [];
  if (f.mode) { where.push("r.game_mode = ?"); args.push(f.mode); }
  if (f.track) { where.push("r.track = ?"); args.push(f.track); }
  if (f.vehicle) { where.push("r.vehicle = ?"); args.push(f.vehicle); }
  if (f.accountId) { where.push("r.account_id = ?"); args.push(f.accountId); }
  const w = where.join(" AND ");
  const total = (s.q(`SELECT COUNT(*) AS n FROM races r WHERE ${w}`).get(...args) as { n: number }).n;
  const rows = s.q(`
    SELECT r.t, r.account_id AS accountId, a.online_id AS name, r.game_mode AS gameMode, r.track, r.vehicle,
           r.position, r.best_time AS bestTime, r.total_time AS totalTime, r.flagged, r.raw
    FROM races r JOIN accounts a ON a.account_id = r.account_id WHERE ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`)
    .all(...args, f.limit, f.offset ?? 0)
    .map((r) => ({ ...r, name: displayName(String(r.name)), place: placeOf(String(r.raw), r.position as number | null), raw: undefined }));
  return { total, rows };
}

/** Best Time Attack lap per track and vehicle (all vehicles of a track, not only the overall record). */
export function records(s: Store) {
  const rows = s.q(`
    SELECT r.track, r.vehicle, a.online_id AS accountName, r.account_id AS accountId, MIN(r.best_time) AS bestTime
    FROM races r JOIN accounts a ON a.account_id = r.account_id
    WHERE r.best_time > 0 AND COALESCE(r.end_normal, 1) <> 0 AND ${s.notFlagged("r.")}
      AND r.game_mode = '9' AND COALESCE(r.track, '') <> '999'
    GROUP BY r.track, r.vehicle ORDER BY CAST(r.track AS INTEGER), CAST(r.vehicle AS INTEGER)`).all() as { track: string; vehicle: string; accountName: string; accountId: number; bestTime: number }[];
  return rows.map((r) => ({ ...r, accountName: displayName(r.accountName) }));
}

/** Server-wide activity: races per mode, per day (last 14 days), busiest tracks and most active drivers. */
export function summary(s: Store) {
  // counted per race (the grouped driver reports), not per report, so a two-driver race counts once
  const matches = matchClusters(s);
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const byMode = new Map<string, number>(), perDay = new Map<string, number>(), perDayMode = new Map<string, number>(), tracks = new Map<string, number>();
  const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const c of matches) {
    add(byMode, c.mode);
    if (c.track) add(tracks, c.track);
    if (c.t >= since) { add(perDay, day(c.t)); add(perDayMode, `${day(c.t)}|${c.mode}`); }
  }
  return {
    byMode: [...byMode].map(([mode, races]) => ({ mode, races })).sort((a, b) => b.races - a.races),
    perDay: [...perDay].map(([d, races]) => ({ day: d, races })).sort((a, b) => a.day.localeCompare(b.day)),
    perDayByMode: [...perDayMode].map(([k, races]) => ({ day: k.split("|")[0], mode: k.split("|")[1], races })).sort((a, b) => a.day.localeCompare(b.day)),
    topTracks: [...tracks].map(([track, races]) => ({ track, races })).sort((a, b) => b.races - a.races).slice(0, 5),
    // a driver's races are his own reports: one per race he took part in
    topDrivers: (s.q(`SELECT a.online_id AS name, COUNT(*) AS races FROM races r JOIN accounts a ON a.account_id = r.account_id
                        WHERE COALESCE(r.track, '') <> '999' AND ${isRace("r.")} GROUP BY r.account_id ORDER BY races DESC LIMIT 5`).all() as { name: string; races: number }[])
      .map((r) => ({ ...r, name: displayName(r.name) })),
  };
}

/** Track 999 is the e2e self-test's race (not a real track) and is left out of listings. */
/** Tracks that have finished races, with the number of players on each (for /api/leaderboards). */
export function tracks(s: Store): { track: string; players: number; races: number; bestTime: number }[] {
  return s.q(`
    SELECT track, COUNT(DISTINCT account_id) AS players, COUNT(*) AS races, MIN(best_time) AS bestTime
    FROM races WHERE track IS NOT NULL AND track <> '999' AND best_time > 0 AND COALESCE(end_normal, 1) <> 0 AND ${s.notFlagged()}
      AND game_mode = '9'
    GROUP BY track ORDER BY CAST(track AS INTEGER)`).all() as { track: string; players: number; races: number; bestTime: number }[];
}

/** Speed / Volcano Weekend board for a track and vehicle (vehicle "0" = any): most time left first, one row per driver. */
export function speedBoard(s: Store, track: string, vehicle: string, onlyAccounts?: number[]): SpeedRow[] {
  const where = ["r.track = ?", "r.best_time > 0", "COALESCE(r.end_normal, 1) = 1", s.notFlagged("r."), "r.game_mode IN ('10', '11')"];
  const args: (string | number)[] = [track];
  if (vehicle && vehicle !== "0") { where.push("r.vehicle = ?"); args.push(vehicle); }
  if (onlyAccounts?.length) { where.push(`r.account_id IN (${onlyAccounts.map(() => "?").join(",")})`); args.push(...onlyAccounts); }
  const rows = s.q(`
    SELECT r.account_id AS accountId, a.online_id AS accountName, MAX(r.best_time) AS timeRemaining,
           (SELECT r2.vehicle FROM races r2 WHERE r2.account_id = r.account_id AND r2.track = r.track AND r2.game_mode IN ('10', '11')
              ORDER BY r2.best_time DESC LIMIT 1) AS vehicle
    FROM races r JOIN accounts a ON a.account_id = r.account_id
    WHERE ${where.join(" AND ")}
    GROUP BY r.account_id ORDER BY timeRemaining DESC`).all(...args) as Omit<SpeedRow, "rank">[];
  return rows.map((r, i) => ({ ...r, accountName: displayName(r.accountName), vehicle: String(r.vehicle ?? "0"), rank: i + 1 }));
}

/** Tracks with Speed / Volcano Weekend races: drivers, races and the most time left. */
export function speedTracks(s: Store): { track: string; players: number; races: number; timeRemaining: number }[] {
  return s.q(`
    SELECT track, COUNT(DISTINCT account_id) AS players, COUNT(*) AS races, MAX(best_time) AS timeRemaining
    FROM races WHERE track IS NOT NULL AND track <> '999' AND best_time > 0 AND COALESCE(end_normal, 1) <> 0 AND ${s.notFlagged()} AND ${isRace()}
      AND game_mode IN ('10', '11')
    GROUP BY track ORDER BY CAST(track AS INTEGER)`).all() as { track: string; players: number; races: number; timeRemaining: number }[];
}

export interface BeatenRow { accountName: string; account: number; time: number; oldTime: number; track: string; vehicle: string }

/**
 * "Somebody beat your time" (`speed-weekend/beaten`): for every track and vehicle where the driver has a Weekend time,
 * the fastest other driver whose better time (more time left) was posted after the driver's own race or after the driver
 * last looked at that board (`speed-weekend/viewed`). At most 200 rows, like the game's parser.
 */
export function weekendBeaten(s: Store, accountId: number): BeatenRow[] {
  const mine = s.q(`
    SELECT track, vehicle, MAX(best_time) AS best FROM races
    WHERE account_id = ? AND game_mode IN ('10', '11') AND best_time > 0 AND COALESCE(end_normal, 1) = 1 AND ${s.notFlagged()}
      AND track IS NOT NULL AND vehicle IS NOT NULL AND track <> '999'
    GROUP BY track, vehicle`).all(accountId) as { track: string; vehicle: string; best: number }[];
  const out: BeatenRow[] = [];
  for (const m of mine) {
    const myAt = (s.q(`SELECT MAX(t) AS t FROM races WHERE account_id = ? AND track = ? AND vehicle = ? AND best_time = ? AND game_mode IN ('10', '11')`)
      .get(accountId, m.track, m.vehicle, m.best) as { t: number }).t;
    const seen = (s.q("SELECT t FROM weekend_views WHERE account_id = ? AND track = ? AND vehicle = ?").get(accountId, m.track, m.vehicle) as { t: number } | undefined)?.t ?? 0;
    const o = s.q(`
      SELECT a.online_id AS name, r.account_id AS account, MAX(r.best_time) AS time FROM races r JOIN accounts a ON a.account_id = r.account_id
      WHERE r.account_id <> ? AND r.track = ? AND r.vehicle = ? AND r.game_mode IN ('10', '11') AND r.best_time > ? AND r.t > ?
        AND COALESCE(r.end_normal, 1) = 1 AND ${s.notFlagged("r.")}`).get(accountId, m.track, m.vehicle, m.best, Math.max(myAt, seen)) as
      { name: string | null; account: number | null; time: number | null };
    if (o.name && o.account !== null && o.time !== null)
      out.push({ accountName: displayName(o.name), account: o.account, time: o.time, oldTime: m.best, track: m.track, vehicle: m.vehicle });
  }
  return out.slice(0, 200);
}

export function weekendViewed(s: Store, accountId: number, track: string, vehicle: string): void {
  s.q("INSERT INTO weekend_views (account_id, track, vehicle, t) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, track, vehicle) DO UPDATE SET t = excluded.t")
    .run(accountId, track, vehicle, Math.floor(Date.now() / 1000) + 1);
}

/** Removes the e2e self-test's races (track 999). */
export function deleteTestRaces(s: Store): number {
  s.raceVersion++;
  return Number(s.q("DELETE FROM races WHERE track = '999'").run().changes);
}

/** The XP a driver had before the race with row id `beforeRowId`: the score of the previous clean Ranked race, or null if there is none. */
export function xpBefore(s: Store, accountId: number, beforeRowId: number): number | null {
  const r = s.q(`
    SELECT CAST(json_extract(raw, '$.score') AS INTEGER) AS score FROM races
    WHERE account_id = ? AND id < ? AND game_mode = '5' AND ${s.notFlagged()} AND COALESCE(end_normal, 1) = 1
      AND COALESCE(track, '') <> '999' AND json_extract(raw, '$.score') IS NOT NULL ORDER BY id DESC LIMIT 1`).get(accountId, beforeRowId) as { score: number } | undefined;
  return r ? r.score : null;
}
