import { trackName, vehicleName } from "../../svo/names.js";
import { raceTime } from "../../svo/protocol.js";
import { intParam } from "../context.js";
import type { Handler } from "../context.js";

// Leaderboards: Ranked standings, Time Attack boards and the best lap per track and vehicle.

const ranked: Handler = (c) => {
  const q = c.url.searchParams, all = c.cached.ranked();
  const off = intParam(q, "offset", 0, 100000);
  c.res.setHeader("X-Total-Count", String(all.length));
  c.json(all.slice(off, off + intParam(q, "limit", 100, 500)));
};

const leaderboard: Handler = (c) => {
  const q = c.url.searchParams;
  const kind = q.get("kind") ?? "timeattack";
  const off = intParam(q, "offset", 0, 100000), limit = intParam(q, "limit", 100, 500);
  if (kind === "ranked") return c.json(c.cached.ranked().slice(off, off + limit));
  // at most 50 numeric ids: every distinct list length is a separate prepared statement
  const friends = q.get("friends") ? q.get("friends")!.split(",").slice(0, 50).map(Number).filter(Number.isInteger) : undefined;
  const track = q.get("track") ?? "1", vehicle = q.get("vehicle") ?? "0";
  if (kind === "speed")
    return c.json({ kind, track, vehicle, trackName: trackName(track), vehicleName: vehicleName(vehicle),
      rows: c.store.speedBoard(track, vehicle, friends).slice(off, off + limit)
        .map((r) => ({ ...r, vehicleName: vehicleName(r.vehicle), timeRemainingText: raceTime(Math.round(r.timeRemaining / 10)) })) });
  c.json({ kind, track, vehicle,
    rows: c.store.board(track, vehicle, c.cfg.leaderboards.timeattackModes, friends).slice(off, off + limit).map((r) => ({ ...r, vehicleName: vehicleName(r.vehicle), bestTimeText: raceTime(r.bestTime) })),
    trackName: trackName(track), vehicleName: vehicleName(vehicle) });
};

const leaderboards: Handler = (c) =>
  c.url.searchParams.get("kind") === "speed"
    ? c.json(c.store.speedTracks().map((t) => ({ ...t, trackName: trackName(t.track), timeRemainingText: raceTime(Math.round(t.timeRemaining / 10)),
        top: c.store.speedBoard(t.track, "0").slice(0, 3)
          .map((r) => ({ ...r, vehicleName: vehicleName(r.vehicle), timeRemainingText: raceTime(Math.round(r.timeRemaining / 10)) })) })))
    : c.json(c.store.tracks().map((t) => ({ ...t, trackName: trackName(t.track), bestTimeText: raceTime(t.bestTime),
    top: c.store.board(t.track, "0", c.cfg.leaderboards.timeattackModes).slice(0, 3)
      .map((r) => ({ ...r, vehicleName: vehicleName(r.vehicle), bestTimeText: raceTime(r.bestTime) })) })));

const records: Handler = (c) =>
  c.json(c.cached.records().map((r) => ({ ...r, trackName: trackName(r.track), vehicleName: vehicleName(r.vehicle), bestTimeText: raceTime(r.bestTime as number) })));

export const routes: Record<string, Handler> = {
  "/api/ranked": ranked, "/api/leaderboard": leaderboard, "/api/leaderboards": leaderboards, "/api/records": records,
};
