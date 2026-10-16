import { raceTimeForMode } from "../../svo/protocol.js";
import { describeMatch, intParam, raceNames } from "../context.js";
import type { Handler } from "../context.js";

// Finished races: one entry per race (matches) or one per driver report (races).

/** The account named by `?player=`, `null` when none was asked for, `undefined` when the name is unknown. */
function player(c: Parameters<Handler>[0]) {
  const name = c.url.searchParams.get("player");
  if (!name) return null;
  return c.account(name.replace(/@RPCN$/i, ""));
}

const matches: Handler = (c) => {
  const q = c.url.searchParams;
  const acc = player(c);
  if (acc === undefined) { c.res.setHeader("X-Total-Count", "0"); return c.json([]); }
  const { total, rows } = c.store.matches({ limit: intParam(q, "limit", 50, 200) || 50, offset: intParam(q, "offset", 0, 100000),
    mode: q.get("mode") ?? undefined, accountId: acc?.account_id, track: q.get("track") ?? undefined });
  c.res.setHeader("X-Total-Count", String(total));
  c.json(rows.map(describeMatch));
};

const match: Handler = (c) => {
  const m = c.store.match(Number(c.url.searchParams.get("id")));
  if (!m) return c.fail(404, { error: "unknown race" });
  c.json(describeMatch(m));
};

const races: Handler = (c) => {
  const q = c.url.searchParams;
  const acc = player(c);
  if (acc === undefined) { c.res.setHeader("X-Total-Count", "0"); return c.json([]); }
  const { total, rows } = c.store.racesFiltered({ limit: intParam(q, "limit", 50, 500) || 50, offset: intParam(q, "offset", 0, 100000),
    mode: q.get("mode") ?? undefined, track: q.get("track") ?? undefined, vehicle: q.get("vehicle") ?? undefined, accountId: acc?.account_id });
  c.res.setHeader("X-Total-Count", String(total));
  c.json((rows as unknown as { bestTime: number }[])
    .map((r) => ({ ...r, ...raceNames(r), bestTimeText: raceTimeForMode((r as unknown as { gameMode: string }).gameMode, r.bestTime) })));
};

export const routes: Record<string, Handler> = { "/api/matches": matches, "/api/match": match, "/api/races": races };
