/**
 * Leaderboard anti-cheat for SVO finishGame reports.
 *
 * The client is trusted for nothing it cannot prove: a race is accepted onto the leaderboards only when the
 * report is internally consistent and physically plausible. Suspicious races are still stored (with the
 * reason in races.flagged) so an admin can review them, but they never appear on any board.
 *
 * Checks (times are hundredths of a second, like the game):
 *   - bestTime is a positive integer and not below antiCheat.minLapTime
 *   - the best lap's split times (bestTimeSplit1..3) add up to bestTime and are all positive
 *   - track (1..30), vehicle (0..8) and laps (1..99, Time Attack 1..2000) are within the game's own ranges
 *   - an account reports at most antiCheat.maxRacesPerMinute races per minute
 */
import { SPEED_MODES } from "./names.js";
export interface AntiCheatConfig {
  enabled: boolean;
  /** Fastest believable lap, hundredths of a second (default 2000 = 20 s; real laps are 40 s+). */
  minLapTime: number;
  /** More finished races than this per account and minute is flagged (a race takes minutes). */
  maxRacesPerMinute: number;
  /** Flagged races within 24 h that trigger an automatic temporary ban (0 = never). */
  autoBanStrikes: number;
  /** Length of an automatic ban in hours (0 = permanent). */
  autoBanHours: number;
  /** Manual ban list in the config folder: "account <name>" / "ip <address>" lines, optional "# reason". */
  bansFile: string;
}

export const DEFAULT_ANTICHEAT: AntiCheatConfig = {
  enabled: true, minLapTime: 2000, maxRacesPerMinute: 6, autoBanStrikes: 3, autoBanHours: 24, bansFile: "bans.txt",
};

const int = (v: string | undefined): number | null =>
  v !== undefined && /^-?\d+$/.test(v) ? Number(v) : null;

/** Returns null for a clean race, otherwise the reason it is kept off the leaderboards. */
/** A race report that arrived with the game's saved backlog and does not match a game on this server: kept off the boards, never a strike. */
export const SAVED_RESULT_PREFIX = "saved result: ";

export function checkRace(p: Record<string, string>, racesLastMinute: number, cfg: AntiCheatConfig): string | null {
  if (!cfg.enabled) return null;
  if (p["location.track"] === "999") return null;          // e2e self-test race (never listed)
  // a race the driver quit or lost the connection in is not a finished race: it has no real time, and the boards
  // ignore it (end_normal), so it is neither judged nor counted as a strike
  if (p.endNormal === "0") return null;

  // Speed / Volcano Weekend: `bestTime` is the time left on the countdown (it can be tiny or zero), not a lap time
  const weekend = SPEED_MODES.has(Number(p["location.gameMode"]));
  const best = int(p.bestTime);
  if (!weekend) {
    // a Time Attack session that ended before any lap was completed has no best time and no splits: nothing to count
    // and nothing to judge (the boards ignore it, and it is not a strike)
    if (Number(p["location.gameMode"]) === 9 && (p.bestTime === undefined || p.bestTime === "") && p.bestTimeSplit1 === undefined) return null;
    if (best === null || best <= 0) return "bestTime missing or not a positive integer";
    if (best < cfg.minLapTime) return `bestTime ${best} below minimum lap time ${cfg.minLapTime}`;

    const splits = ["bestTimeSplit1", "bestTimeSplit2", "bestTimeSplit3"].map((k) => p[k]).filter((v) => v !== undefined);
    if (splits.length) {
      const nums = splits.map((v) => int(v));
      if (nums.some((n) => n === null || n <= 0)) return "non-positive split time";
      const sum = (nums as number[]).reduce((a, b) => a + b, 0);
      if (splits.length === 3 && Math.abs(sum - best) > 1) return `split times add up to ${sum}, not bestTime ${best}`;
    }
  }

  // the game's own ranges (names.ts): tracks 1..30, vehicle = class + 1 (0 = any), laps per race
  // Time Attack has no lap limit (a real practice session had 119 laps); a custom race was seen with 29 laps, so races get 99
  const maxLaps = Number(p["location.gameMode"]) === 9 ? 2000 : 99;
  for (const [k, min, max] of [["location.track", 1, 30], ["location.vehicle", 0, 8], ["laps", 1, maxLaps]] as const) {
    if (p[k] === undefined) continue;
    const n = int(p[k]);
    if (n === null || n < min || n > max) return `${k}=${p[k]} out of range`;
  }

  if (racesLastMinute >= cfg.maxRacesPerMinute) return `${racesLastMinute + 1} races within a minute`;
  return null;
}
