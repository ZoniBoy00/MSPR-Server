import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "../../config.js";
import { GAME_MODES, ONLINE_MODES, TRACKS, VEHICLES } from "../../svo/names.js";
import { API_INDEX } from "../catalog.js";
import { horizonMspr, shortName } from "../context.js";
import type { Handler } from "../context.js";

// Status and system endpoints: the API index, health, status, name tables, bans and the live data from Horizon.

const startedAt = Date.now();
const PACKAGE_VERSION = (() => {
  try { return (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../package.json"), "utf8")) as { version?: string }).version ?? "unknown"; }
  catch { return "unknown"; }
})();

const index: Handler = (c) => c.json(API_INDEX);

const health: Handler = async (c) => {
  const st = await horizonMspr(c.cfg);
  const s = c.store.stats();
  c.json({ ok: true, version: PACKAGE_VERSION, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    node: process.version, accounts: s.accounts, races: s.races, horizon: st.error ? `unreachable: ${st.error}` : "ok",
    playersOnline: (st.players ?? []).length, gamesLive: (st.games ?? []).length });
};

const status: Handler = async (c) => {
  const st = await horizonMspr(c.cfg);
  const live = c.allowed("live"), history = c.allowed("raceHistory");
  const s = c.store.stats();
  c.json({ ...s, recent: history ? s.recent : [], announcement: readText(c.cfg.svo.announcementFile), online: {
    players: live ? (st.players ?? []).map((p) => shortName(p.name)) : [],
    games: live ? (st.games ?? []).map((g) => ({ name: g.name, type: g.type, world: g.worldId, players: g.players.map((p) => shortName(p.name)) })) : [],
    count: (st.players ?? []).length,
    horizon: st.error ? `unreachable: ${st.error}` : "ok",
  } });
};

const meta: Handler = (c) => c.json({ tracks: TRACKS, vehicles: VEHICLES, modes: GAME_MODES, onlineModes: [...ONLINE_MODES] });

const bans: Handler = (c) =>
  c.json(c.store.bans().map((b) => ({ ...b, value: b.kind === "account" ? b.value.replace(/@PSN$/i, "") : "(hidden)" })));

const players: Handler = async (c) => {
  const st = await horizonMspr(c.cfg);
  c.json(st.error ? { error: st.error } : (st.players ?? []).map((p) => ({ ...p, name: shortName(p.name) })));
};

const games: Handler = async (c) => {
  const st = await horizonMspr(c.cfg);
  const type = c.url.searchParams.get("type");
  c.json(st.error ? { error: st.error } : (st.games ?? []).filter((g) => !type || g.type === type));
};

const matchmaking: Handler = async (c) => {
  const st = await horizonMspr(c.cfg);
  c.json(st.error ? { error: st.error } : st.matchmaking ?? []);
};

export const routes: Record<string, Handler> = {
  "/api": index, "/api/": index, "/api/health": health, "/api/status": status, "/api/meta": meta, "/api/bans": bans,
  "/api/players": players, "/api/games": games, "/api/matchmaking": matchmaking,
};
