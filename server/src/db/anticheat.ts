import type { Store } from "./store.js";
import { displayName } from "./types.js";
import { matchClusters } from "./matches.js";

// Anti-cheat records: findings to review and the overview behind the Anti-cheat page.

export function addEvent(s: Store, accountId: number, raceId: number | null, kind: string, detail: string): void {
  s.q("INSERT OR IGNORE INTO anticheat_events (t, account_id, race_id, kind, detail) VALUES (?, ?, ?, ?, ?)")
    .run(Math.floor(Date.now() / 1000), accountId, raceId, kind, detail);
}

/** Everything the anti-cheat has noticed: rejected races, findings to review, and the totals. */
export function anticheatOverview(s: Store, limit = 100) {
  const week = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rowToMatch = new Map<number, number>();
  for (const c of matchClusters(s)) for (const id of c.rowIds) rowToMatch.set(id, c.id);
  const rejected = (s.q(`
    SELECT r.id, r.t, a.online_id AS name, r.game_mode AS mode, r.track, r.flagged AS reason
    FROM races r JOIN accounts a ON a.account_id = r.account_id WHERE r.flagged IS NOT NULL ORDER BY r.id DESC LIMIT ?`).all(limit) as
    { id: number; t: number; name: string; mode: string; track: string; reason: string }[])
    .map((r) => ({ ...r, name: displayName(r.name), matchId: rowToMatch.get(r.id) ?? null }));
  const findings = (s.q(`
    SELECT e.id, e.t, a.online_id AS name, e.race_id AS raceRowId, e.kind, e.detail
    FROM anticheat_events e JOIN accounts a ON a.account_id = e.account_id ORDER BY e.id DESC LIMIT ?`).all(limit) as
    { id: number; t: number; name: string; raceRowId: number | null; kind: string; detail: string }[])
    .map((e) => ({ ...e, name: displayName(e.name), matchId: e.raceRowId === null ? null : rowToMatch.get(e.raceRowId) ?? null }));
  const n = (sql: string, ...a: number[]) => (s.q(sql).get(...a) as { n: number }).n;
  return {
    counts: {
      rejectedTotal: n("SELECT COUNT(*) AS n FROM races WHERE flagged IS NOT NULL"),
      rejectedWeek: n("SELECT COUNT(*) AS n FROM races WHERE flagged IS NOT NULL AND t >= ?", week),
      findingsTotal: n("SELECT COUNT(*) AS n FROM anticheat_events"),
      findingsWeek: n("SELECT COUNT(*) AS n FROM anticheat_events WHERE t >= ?", week),
      racesChecked: n("SELECT COUNT(*) AS n FROM races WHERE COALESCE(track, '') <> '999'"),
      matches: matchClusters(s).length,
    },
    rejected, findings,
  };
}

/** Flagged (anti-cheat) races of an account within the last `seconds`. */
/**
 * Flagged races of an account in the last `seconds` that count as STRIKES towards an automatic ban. A race is kept off
 * the boards for many reasons, but only a report that is wrong on its own (impossible lap time, splits that do not add
 * up, values out of range ...) is evidence of cheating. These are not strikes, however often they happen:
 *   - "saved result: ..."          the game's saved backlog after a login
 *   - "... race reported but ..."  the player was in no game of that kind on the server: Horizon's snapshot can lag, a
 *   - "placing N in a game of M"   game can be missing after a restart, and a real PS3 posts results of other servers
 *   - "race time ..."              (the three checks that compare the report with what Horizon saw)
 *   - "banned account ..."         the report of an already banned account
 */
export function flaggedRaceCount(s: Store, accountId: number, seconds: number): number {
  return (s.q(`SELECT COUNT(*) AS n FROM races WHERE account_id = ? AND flagged IS NOT NULL AND t >= ?
      AND flagged NOT LIKE 'saved result: %' AND flagged NOT LIKE '% race reported but %' AND flagged NOT LIKE 'placing % in a game of %'
      AND flagged NOT LIKE 'race time %' AND flagged NOT LIKE 'banned account%'`)
    .get(accountId, Math.floor(Date.now() / 1000) - seconds) as { n: number }).n;
}
