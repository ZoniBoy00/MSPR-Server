import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { SPEED_MODES, gameModeName, trackName, vehicleName } from "../svo/names.js";
import { raceTimeForMode } from "../svo/protocol.js";
import type { Diagnostics } from "../ops/diagnostics.js";
import type { Pseudonyms, Section } from "./privacy.js";
import { memo } from "./ratelimit.js";

/** What a route handler gets: the request, the shared services and helpers to answer. */
export interface Ctx {
  cfg: Config;
  store: Store;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** The server's event journal (admin only through /api/diagnostics). */
  diag?: Diagnostics;
  /** The viewer is local to the server or sent the admin token. */
  admin: boolean;
  /** Whether this viewer may see a restricted section (always true for an admin). */
  allowed: (section: Section) => boolean;
  /** The account named by a player name from the request; with pseudonyms on, non-admins name drivers by their alias. */
  account: (name: string) => ReturnType<Store["accountByName"]>;
  cached: { ranked: () => ReturnType<Store["rankedBoard"]>; summary: () => ReturnType<Store["summary"]>; records: () => ReturnType<Store["records"]> };
  /** Answers 200 with JSON (compressed when the client accepts it and the body is large enough). */
  json: (body: unknown) => void;
  /** Answers with a status and a JSON body, for example `{ error: "unknown race" }`. */
  fail: (status: number, body: unknown) => void;
}

export type Handler = (c: Ctx) => void | Promise<void>;

/** Short-lived caches for the heavier read-only queries (the site polls every few seconds from every open tab). */
export function makeCaches(store: Store): Ctx["cached"] {
  return {
    ranked: memo(3000, () => store.rankedBoard(["score", "playersBeaten"])),
    summary: memo(3000, () => store.summary()),
    records: memo(3000, () => store.records()),
  };
}

/** Sends `body` with the right headers; bodies over 1 kB go out gzip-compressed when the client accepts it. */
export function send(req: IncomingMessage, res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void {
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  const headers: Record<string, string> = { "Content-Type": type, Vary: "Accept-Encoding", ...extra };
  if (buf.length > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
    const z = gzipSync(buf, { level: 6 });
    res.writeHead(status, { ...headers, "Content-Encoding": "gzip", "Content-Length": String(z.length) });
    res.end(z);
  } else {
    res.writeHead(status, { ...headers, "Content-Length": String(buf.length) });
    res.end(buf);
  }
}

/** Integer query parameter, clamped to 0..max, `def` when missing or not a number. */
export const intParam = (q: URLSearchParams, k: string, def: number, max: number) =>
  Math.min(max, Math.max(0, Math.floor(Number(q.get(k) ?? def)) || def));

/** RPCN names come with a "@RPCN" suffix from Horizon. */
export const shortName = (n: string) => n.replace(/@RPCN$/, "");

export interface MsprGame { worldId: number; name: string; type: string; status: string; players: { name: string }[] }
export interface MsprPlayer { accountId: number; name: string; worldId?: number | null; game?: string | null }
export interface MsprState { players?: MsprPlayer[]; games?: MsprGame[]; matchmaking?: unknown[]; error?: string }

/** Live Medius data from Horizon's CRUD endpoint (`{ error }` when Horizon does not answer). */
export async function horizonMspr(cfg: Config): Promise<MsprState> {
  try {
    const r = await fetch(`${cfg.horizon.crudUrl}/GetMspr/`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? (await r.json()) as MsprState : { error: `HTTP ${r.status}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Readable names next to the raw ids in API rows. */
export const raceNames = (r: Record<string, unknown>) =>
  ({ gameModeName: gameModeName(r.gameMode), trackName: trackName(r.track), vehicleName: vehicleName(r.vehicle) });

export type MatchRow = NonNullable<ReturnType<Store["match"]>>;

/** A match with readable names and times. Online modes report milliseconds, offline modes hundredths; distances are millimetres. */
export function describeMatch(m: MatchRow) {
  const online = ["4", "5", "6"].includes(m.mode);
  const speed = SPEED_MODES.has(Number(m.mode));              // a race against the countdown: `bestTime` is the time left
  const km = (mm: number | null) => (mm === null ? null : Math.round(mm / 10000) / 100);
  const players = m.players.map((p) => ({
    ...p, vehicleName: vehicleName(p.vehicle),
    timeText: online || speed ? raceTimeForMode(m.mode, p.totalTime) : raceTimeForMode(m.mode, p.bestTime),
    bestTimeText: raceTimeForMode(m.mode, p.bestTime),
    timeRemainingText: speed ? raceTimeForMode(m.mode, p.bestTime) : null,
    timeInFirstText: p.timeInFirst ? raceTimeForMode(m.mode, p.timeInFirst) : null,
    distanceKm: km(p.distance), boostKm: km(p.boostDistance), furthestBoostKm: km(p.furthestBoost), jumpKm: km(p.jumpDistance), furthestJumpKm: km(p.furthestJump),
  }));
  return { id: m.id, t: m.t, mode: m.mode, modeName: gameModeName(m.mode), track: m.track, trackName: trackName(m.track),
    laps: players.find((p) => p.laps !== null)?.laps ?? null, playerCount: players.length, winner: players.find((p) => p.place === 1)?.name ?? null, players };
}
