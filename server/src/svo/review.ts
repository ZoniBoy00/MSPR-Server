/**
 * Second layer of the anti-cheat: findings that are worth a look but are not proof.
 *
 * `checkRace` and the online tracker reject a race outright (it stays off every board and counts as a strike).
 * The checks here never reject. They record a finding for the Anti-cheat page so that an admin can judge it,
 * because some of them rest on readings of the game's data that are inferred and not documented:
 *
 *   - place and time disagree: the driver who finished ahead of another must not have the slower race time
 *   - the driver says he won but has another place
 *   - the distance driven divided by the race time is faster than any vehicle
 *   - the XP of a Ranked race does not follow from the previous XP, the finishing order and the opponents' levels
 *     (the game's own rules, see online/rank.ts)
 *   - the Medius stats blob went backwards (the race counters only ever grow; the XP at offset 8 is left out: it falls on a loss)
 */
import { MS_MODES, ONLINE_MODES } from "./names.js";
import { expectedXp, levelOf } from "../online/rank.js";
/** Finishing place of a report: the placedN flag, then playersBeatenBy, then the 0-based position. */
function placeOfReport(p: Record<string, string>): number | null {
  for (const [k, v] of Object.entries(p)) {
    const m = /^placed(\d+)$/.exec(k);
    if (m && Number(v) > 0) return Number(m[1]);
  }
  if (p.playersBeatenBy !== undefined && p.playersBeatenBy !== "" && Number.isFinite(Number(p.playersBeatenBy))) return Number(p.playersBeatenBy) + 1;
  return p.position !== undefined && p.position !== "" && Number.isFinite(Number(p.position)) ? Number(p.position) + 1 : null;
}

export interface Finding { kind: string; detail: string }
export interface MatchEntry { accountId: number; name: string; place: number | null; totalTime: number | null; finished: boolean | null; won: boolean }

/** Metres per second above which a report is called implausible (432 km/h; a boosting vehicle reaches about a third of that). */
export const MAX_SPEED_MS = 120;

/** Hard impossibility inside one report; the race is rejected. Null when the numbers can be true. */
export function impossibleReport(p: Record<string, string>): string | null {
  const total = Number(p.totalRaceTime), first = Number(p.totalRaceTimeInFirst);
  if (Number.isFinite(total) && Number.isFinite(first) && total > 0 && first > total + 50)
    return `time in first place (${first} ms) is longer than the race itself (${total} ms)`;
  return null;
}

/** Findings from one report on its own. */
export function reviewReport(p: Record<string, string>): Finding[] {
  const out: Finding[] = [];
  const mode = Number(p["location.gameMode"]);
  const ms = MS_MODES.has(mode) ? Number(p.totalRaceTime) : Number(p.totalRaceTime) * 10;       // other times are hundredths
  const mm = Number(p.distanceTravelled);
  if (Number.isFinite(ms) && ms > 5000 && Number.isFinite(mm) && mm > 0) {
    const speed = mm / ms;                                                          // millimetres per millisecond = metres per second
    if (speed > MAX_SPEED_MS) out.push({ kind: "speed", detail: `${mm / 1e6} km in ${(ms / 1000).toFixed(1)} s is ${Math.round(speed * 3.6)} km/h on average` });
  }
  const place = placeOfReport(p);
  // `won` has a meaning for a place only against other drivers (a Weekend race is run alone against the clock)
  if (ONLINE_MODES.has(mode) && p.won === "1" && place !== null && place !== 1) out.push({ kind: "won-mismatch", detail: `reports a win but the place is ${place}` });
  return out;
}

/**
 * Findings from the reports of one race. Every driver reports separately, so the reports must agree with each other.
 * A finding is attributed to the driver whose claim does not fit.
 */
export function reviewMatch(players: MatchEntry[]): (Finding & { accountId: number })[] {
  const out: (Finding & { accountId: number })[] = [];
  const done = players.filter((x) => x.finished && x.place !== null && x.totalTime !== null && x.totalTime > 0);
  for (const a of done) {
    const slowerAhead = done.find((b) => b.place! > a.place! && b.totalTime! < a.totalTime! - 50);
    if (slowerAhead)
      out.push({ accountId: a.accountId, kind: "place-vs-time",
        detail: `${a.name} is place ${a.place} with ${a.totalTime} ms but ${slowerAhead.name}, place ${slowerAhead.place}, finished in ${slowerAhead.totalTime} ms` });
  }
  const winners = players.filter((x) => x.place === 1);
  if (winners.length > 1) for (const w of winners) out.push({ accountId: w.accountId, kind: "two-winners", detail: `${winners.length} drivers report first place` });
  return out;
}

/** Offsets (big-endian u32) of the stats blob fields that can only grow. Inferred from recorded blobs of real races. */
const MONOTONIC: [number, string][] = [[16, "Ranked races"], [20, "Casual races"], [24, "Custom races"], [28, "online races"], [72, "races"]];

export function statsRollback(prev: Buffer | null, next: Buffer): Finding[] {
  if (!prev) return [];
  const out: Finding[] = [];
  for (const [off, label] of MONOTONIC) {
    if (prev.length < off + 4 || next.length < off + 4) continue;
    const a = prev.readUInt32BE(off), b = next.readUInt32BE(off);
    if (b < a) out.push({ kind: "stats-rollback", detail: `${label} went from ${a} to ${b}` });
  }
  return out;
}

export interface XpEntry { accountId: number; name: string; place: number | null; score: number | null; finished: boolean | null; flagged: string | null }

/**
 * Checks the XP that each driver of a Ranked race reports against the game's rules. `before` is the XP the driver had
 * before the race (the score of the previous clean Ranked race). A driver is judged only when the driver and every
 * opponent in the list have a known XP before the race, and the places are known. The check can be off when
 * drivers of the game have not reported (their points are missing) or the driver has played elsewhere in between.
 * Two outcomes are accepted that the rules allow: the exact expected XP, and an unchanged XP after a loss (the
 * 3-race immunity after a rank-up).
 */
export function reviewXp(players: XpEntry[], before: Map<number, number>): (Finding & { accountId: number })[] {
  const out: (Finding & { accountId: number })[] = [];
  const judged = players.filter((x) => x.score !== null && x.place !== null && x.finished !== false && x.flagged === null && before.has(x.accountId));
  for (const p of judged) {
    const others = judged.filter((o) => o !== p);
    if (!others.length || others.length < players.length - 1) continue;              // an opponent is not known: the points would be incomplete
    const xp0 = before.get(p.accountId)!;
    const expected = expectedXp(xp0, others.map((o) => ({ level: levelOf(before.get(o.accountId)!), beaten: p.place! < o.place! })));
    if (p.score === expected || (p.score === xp0 && expected < xp0)) continue;
    out.push({ accountId: p.accountId, kind: "xp-mismatch",
      detail: `${p.name} reports ${p.score} XP after ${xp0} XP, the rules give ${expected} (place ${p.place} against ${others.length} known driver${others.length === 1 ? "" : "s"})` });
  }
  return out;
}
