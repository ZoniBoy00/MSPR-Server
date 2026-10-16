import type { Store } from "./store.js";
import { displayName, isRace, placeOf } from "./types.js";

// Matches: the reports of the drivers of one race grouped together. The grouping is cached until a new race arrives.

/**
 * Groups finished-race reports into matches. Every player of an online race reports separately, so reports of the
 * same mode, track and game id that arrive within three minutes of the first one belong together. A single-player
 * mode report is a match of its own. A match id is its number in the order the races were first reported (1, 2, 3 ...); it
 * does not change when later reports join.
 */
export function matchClusters(s: Store): Cluster[] {
  const hit = cache.get(s);
  if (hit && hit.version === s.raceVersion) return hit.list;
  const list = computeClusters(s);
  cache.set(s, { version: s.raceVersion, list });
  return list;
}

interface Cluster { id: number; t: number; mode: string; track: string; rowIds: number[] }
/** The grouping is recomputed only after a race was stored. Callers must not change the returned list. */
const cache = new WeakMap<Store, { version: number; list: Cluster[] }>();

function computeClusters(s: Store): Cluster[] {
  const rows = s.q(`
    SELECT r.id, r.t, r.account_id AS accountId, r.game_mode AS mode, COALESCE(r.track, '') AS track, json_extract(r.raw, '$.gameId') AS gameId
    FROM races r WHERE COALESCE(r.track, '') <> '999' AND ${isRace("r.")} ORDER BY r.id DESC LIMIT 20000`).all() as
    { id: number; t: number; accountId: number; mode: string | null; track: string; gameId: string | null }[];
  rows.reverse();
  const clusters: { id: number; t: number; mode: string; track: string; rowIds: number[]; accounts: Set<number> }[] = [];
  const open = new Map<string, number>();
  for (const r of rows) {
    const mode = String(r.mode ?? "");
    const online = ["4", "5", "6"].includes(mode) && r.gameId !== null;
    const key = `${mode}|${r.track}|${r.gameId}`;
    const at = online ? open.get(key) : undefined;
    const c = at === undefined ? undefined : clusters[at];
    if (c && r.t - c.t <= 180 && !c.accounts.has(r.accountId)) {
      c.rowIds.push(r.id);
      c.accounts.add(r.accountId);
    } else {
      clusters.push({ id: clusters.length + 1, t: r.t, mode, track: r.track, rowIds: [r.id], accounts: new Set([r.accountId]) });
      if (online) open.set(key, clusters.length - 1);
    }
  }
  return clusters.map(({ id, t, mode, track, rowIds }) => ({ id, t, mode, track, rowIds }));
}

export function matchPlayers(s: Store, rowIds: number[]) {
  if (!rowIds.length) return [];
  const rows = s.q(`
    SELECT r.id, r.account_id AS accountId, a.online_id AS name, r.vehicle, r.position, r.best_time AS bestTime, r.total_time AS totalTime,
           r.end_normal AS endNormal, r.flagged, r.raw
    FROM races r JOIN accounts a ON a.account_id = r.account_id WHERE r.id IN (${rowIds.map(() => "?").join(",")})`).all(...rowIds) as
    Record<string, unknown>[];
  const num = (p: Record<string, string>, k: string) => (p[k] !== undefined && p[k] !== "" && Number.isFinite(Number(p[k])) ? Number(p[k]) : null);
  return rows.map((r) => {
    let p: Record<string, string> = {};
    try { p = JSON.parse(String(r.raw)) as Record<string, string>; } catch { /* keep empty */ }
    return {
      accountId: Number(r.accountId), name: displayName(String(r.name)), vehicle: r.vehicle === null ? null : String(r.vehicle),
      place: placeOf(String(r.raw), r.position as number | null), bestTime: r.bestTime as number | null, totalTime: r.totalTime as number | null,
      timeInFirst: num(p, "totalRaceTimeInFirst"), laps: num(p, "laps"), score: num(p, "score"), playersBeaten: num(p, "playersBeaten"),
      playersBeatenBy: num(p, "playersBeatenBy"), won: p.won === "1", finished: r.endNormal === null ? null : Number(r.endNormal) === 1,
      wrecks: num(p, "wrecks"), distance: num(p, "distanceTravelled"), boostDistance: num(p, "boostDistance"),
      furthestBoost: num(p, "furthestBoostDistance"), jumps: num(p, "jumps"), jumpDistance: num(p, "jumpDistance"),
      furthestJump: num(p, "furthestJumpDistance"), flagged: r.flagged as string | null, gameName: p.gameName ?? null,
    };
  }).sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
}

/** Matches, newest first, optionally only those of one mode or one driver; `total` is the unpaged count. */
export function matches(s: Store, f: { limit: number; offset?: number; mode?: string; accountId?: number; track?: string }) {
  let list = matchClusters(s).slice();
  if (f.mode) list = list.filter((c) => c.mode === f.mode);
  if (f.track) list = list.filter((c) => c.track === f.track);
  if (f.accountId) {
    const mine = new Set((s.q("SELECT id FROM races WHERE account_id = ?").all(f.accountId) as { id: number }[]).map((r) => r.id));
    list = list.filter((c) => c.rowIds.some((id) => mine.has(id)));
  }
  list.sort((a, b) => b.id - a.id);
  const page = list.slice(f.offset ?? 0, (f.offset ?? 0) + f.limit);
  return { total: list.length, rows: page.map((c) => ({ id: c.id, t: c.t, mode: c.mode, track: c.track, players: matchPlayers(s, c.rowIds) })) };
}

/** The match a race report (row id) belongs to. */
export function matchOfRace(s: Store, rowId: number) {
  const c = matchClusters(s).find((x) => x.rowIds.includes(rowId));
  return c ? { id: c.id, t: c.t, mode: c.mode, track: c.track, firstRowId: Math.min(...c.rowIds), players: matchPlayers(s, c.rowIds) } : undefined;
}

/** One match with every player's report, or undefined for an unknown id. */
export function match(s: Store, id: number) {
  const c = matchClusters(s).find((x) => x.id === id);
  return c ? { id: c.id, t: c.t, mode: c.mode, track: c.track, players: matchPlayers(s, c.rowIds) } : undefined;
}
