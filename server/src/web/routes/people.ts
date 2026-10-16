import { gameModeName, trackName, vehicleName } from "../../svo/names.js";
import { raceTime, raceTimeForMode } from "../../svo/protocol.js";
import { describeMatch, horizonMspr, intParam, raceNames } from "../context.js";
import type { Handler } from "../context.js";

// Drivers, tracks and the server-wide summary.

const playerProfile: Handler = async (c) => {
  const name = (c.url.searchParams.get("name") ?? "").replace(/@RPCN$/i, "");
  const acc = name ? c.account(name) : undefined;
  if (!acc) return c.fail(404, { error: "unknown driver" });
  const prof = c.store.playerProfile(acc);
  const st = await horizonMspr(c.cfg);
  const live = (st.players ?? []).find((p) => p.accountId === acc.account_id);
  const showLive = c.allowed("live"), history = c.allowed("raceHistory");
  c.json({ ...prof, online: showLive && !!live, game: showLive ? live?.game ?? null : null,
    byMode: prof.byMode.map((m) => ({ ...m, modeName: gameModeName(m.mode) })),
    timeAttackBests: prof.timeAttackBests.map((b) => ({ ...b, trackName: trackName(b.track), vehicleName: vehicleName(b.vehicle), bestTimeText: raceTime(b.bestTime as number) })),
    recent: !history ? [] : prof.recent.map((r) => ({ ...r, ...raceNames(r), bestTimeText: raceTimeForMode((r as unknown as { gameMode: string }).gameMode, (r as unknown as { bestTime: number }).bestTime) })) });
};

const drivers: Handler = async (c) => {
  const q = c.url.searchParams;
  const { total, rows } = c.store.drivers({ q: q.get("q") ?? undefined, sort: q.get("sort") ?? undefined, limit: intParam(q, "limit", 100, 500) || 100, offset: intParam(q, "offset", 0, 100000) });
  const st = await horizonMspr(c.cfg);
  const online = new Set((st.players ?? []).map((p) => p.accountId));
  c.res.setHeader("X-Total-Count", String(total));
  const showLive = c.allowed("live");
  c.json(rows.map((r) => ({ ...r, online: showLive && online.has(r.accountId) })));
};

/** Track summaries with readable names. */
function describedTracks(c: Parameters<Handler>[0]) {
  return c.store.trackSummaries().map((t) => ({
    ...t, trackName: trackName(t.track),
    modes: t.modes.map((m) => ({ ...m, modeName: gameModeName(m.mode) })),
    vehicles: t.vehicles.map((v) => ({ ...v, vehicleName: vehicleName(v.vehicle) })),
    record: t.record ? { ...t.record, vehicleName: vehicleName(t.record.vehicle), bestTimeText: raceTime(t.record.bestTime) } : null,
    records: t.records.map((r) => ({ ...r, vehicleName: vehicleName(r.vehicle), bestTimeText: raceTime(r.bestTime) })),
  }));
}

const tracks: Handler = (c) => c.json(describedTracks(c).map(({ records: _records, ...rest }) => rest));

const track: Handler = (c) => {
  const one = describedTracks(c).find((t) => t.track === c.url.searchParams.get("id"));
  if (!one) return c.fail(404, { error: "no races on this track yet" });
  c.json({ ...one, recent: c.allowed("raceHistory") ? c.store.matches({ limit: 8, track: one.track }).rows.map(describeMatch) : [] });
};

const summary: Handler = (c) => {
  const s = c.cached.summary();
  c.json({ ...s, byMode: s.byMode.map((m) => ({ ...m, modeName: gameModeName(m.mode) })),
    perDayByMode: s.perDayByMode.map((m) => ({ ...m, modeName: gameModeName(m.mode) })), topTracks: s.topTracks.map((t) => ({ ...t, trackName: trackName(t.track) })) });
};

export const routes: Record<string, Handler> = {
  "/api/player": playerProfile, "/api/drivers": drivers, "/api/tracks": tracks, "/api/track": track, "/api/summary": summary,
};
