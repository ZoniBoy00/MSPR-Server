import { gameModeName, trackName } from "../../svo/names.js";
import { intParam } from "../context.js";
import type { Handler } from "../context.js";

const anticheat: Handler = (c) => {
  const o = c.store.anticheatOverview(intParam(c.url.searchParams, "limit", 100, 500) || 100);
  const { enabled, autoBanStrikes, autoBanHours } = c.cfg.antiCheat;
  c.json({ enabled, autoBanStrikes, autoBanHours, ...o,
    rejected: o.rejected.map((r) => ({ ...r, modeName: gameModeName(r.mode), trackName: trackName(r.track) })) });
};

export const routes: Record<string, Handler> = { "/api/anticheat": anticheat };
