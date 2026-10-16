// Shared types and small helpers of the database layer.

export interface Account {
  account_id: number;
  online_id: string;
  np_user_id: string | null;
  created: number;
  last_login: number;
  eula_hash: string | null;
}

export interface RankedRow { accountId: number; accountName: string; rank: number; races: number; wins: number; level: number; rankTier: number; stats: Record<string, number> }

/**
 * Finishing place among the human racers (1 = first). finishGame's `position` is not it: it counts the whole field and
 * both racers of a 2-player race report 2. The `placedN=1` flag (N = place) and `playersBeatenBy` are exact, so use them first.
 */
export function placeOf(raw: string | null | undefined, position: number | null | undefined): number | null {
  try {
    const p = JSON.parse(raw ?? "{}") as Record<string, string>;
    // against the clock there is no field to place in: a Time Attack lap has none, a Speed / Volcano Weekend run is a win (`won=1`) or not
    if (p["location.gameMode"] === "9") return null;
    if (p["location.gameMode"] === "10" || p["location.gameMode"] === "11") return p.won === "1" ? 1 : null;
    if (position !== null && position !== undefined && position >= 100) return null;       // 100 = did not finish
    for (const [k, v] of Object.entries(p)) {
      const m = /^placed(\d+)$/.exec(k);
      if (m && Number(v) > 0) return Number(m[1]);
    }
    if (p.playersBeatenBy !== undefined && p.playersBeatenBy !== "" && Number.isFinite(Number(p.playersBeatenBy))) return Number(p.playersBeatenBy) + 1;
  } catch { /* fall through to position */ }
  return position === null || position === undefined ? null : position + 1;
}

/**
 * SQL: "this row is a race, not a bookkeeping report". After a Weekend race the game posts a second report with only the
 * best time (no total race time, 0 laps, position 100); it is stored but must not show up as a race of its own.
 * `prefix` is a table alias such as "r.".
 */
export const isRace = (prefix = "") => `NOT (${prefix}game_mode IN ('10', '11') AND ${prefix}total_time IS NULL)`;

/** A Speed / Volcano Weekend board row: the most time left on the clock (milliseconds), more is better. */
export interface SpeedRow { accountId: number; accountName: string; timeRemaining: number; vehicle: string; rank: number }

export interface BoardRow {
  accountId: number;
  accountName: string;
  bestTime: number;
  vehicle: string;
  rank: number;
}

/** PSN (real PS3) accounts are stored as "name@PSN" to keep them apart from RPCN users; players see the plain name. */
export const displayName = (onlineId: string) => onlineId.replace(/@PSN$/i, "");

/** SQLite storage (node:sqlite, no native deps). */
