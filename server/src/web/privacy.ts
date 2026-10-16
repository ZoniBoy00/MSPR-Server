import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Privacy controls for the status site and the read-only API.
 *
 * Every section is either `public` (anybody who can reach the site) or `admin` (only a viewer who is local to the server or
 * sends the admin token). `pseudonymize` replaces every player name in the answers to non-admin viewers with a stable alias.
 * The leaderboards, tracks, records and the ranked table stay available in every mode.
 */
export type Level = "public" | "admin";
export interface Privacy {
  /** The anti-cheat report: rejected races, findings, who was flagged. */
  anticheat: Level;
  /** Active bans. */
  bans: Level;
  /** Who is online now: logged-in players, live games, the matchmaking queue. */
  live: Level;
  /** Single races with every driver's result, the Races tab, a driver's recent races. */
  raceHistory: Level;
  /** Replace player names with `Driver-xxxxxx` for non-admin viewers. */
  pseudonymize: boolean;
  /** Secret that makes the aliases unguessable; random on every start when empty (aliases then change after a restart). */
  salt: string;
}

export const DEFAULT_PRIVACY: Privacy = { anticheat: "admin", bans: "public", live: "public", raceHistory: "public", pseudonymize: false, salt: "" };

export type Section = "anticheat" | "bans" | "live" | "raceHistory" | "diagnostics";

/** Which API paths belong to a section. Anything not listed is public in every mode. */
export const GATES: Record<string, Section> = {
  "/api/anticheat": "anticheat",
  "/api/bans": "bans",
  "/api/diagnostics": "diagnostics",
  "/api/players": "live", "/api/games": "live", "/api/matchmaking": "live",
  "/api/races": "raceHistory", "/api/matches": "raceHistory", "/api/match": "raceHistory",
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * A viewer is an admin when the request carries the configured token (`Authorization: Bearer <token>` or `X-Admin-Token`),
 * or comes from the server's own machine. A request with `X-Forwarded-For` is never treated as local: behind a reverse proxy
 * every request would otherwise look like loopback.
 */
export function isAdmin(req: IncomingMessage, token: string | null | undefined): boolean {
  if (token) {
    const h = req.headers.authorization, given = (typeof h === "string" && /^Bearer /i.test(h) ? h.slice(7) : String(req.headers["x-admin-token"] ?? "")).trim();
    if (given) {
      const a = Buffer.from(given), b = Buffer.from(token);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
  }
  return LOOPBACK.has(req.socket.remoteAddress ?? "") && !req.headers["x-forwarded-for"];
}

/** Aliases and their reverse lookup. */
export class Pseudonyms {
  private key: Buffer;
  constructor(salt: string) { this.key = salt ? Buffer.from(salt) : randomBytes(16); }
  alias(name: string): string {
    return "Driver-" + createHmac("sha256", this.key).update(name.replace(/@(RPCN|PSN)$/i, "").toLowerCase()).digest("hex").slice(0, 6);
  }
  /** The real name behind an alias, searched in `names`; `undefined` when none matches. */
  resolve(alias: string, names: Iterable<string>): string | undefined {
    if (!/^Driver-[0-9a-f]{6}$/.test(alias)) return undefined;
    for (const n of names) if (this.alias(n) === alias) return n;
    return undefined;
  }
  /** Copy of `value` with every player name replaced. Names sit under `name` (not on a game), `accountName` and `winner`, and in `players` lists of plain strings. */
  mask<T>(value: T): T {
    const walk = (v: unknown, key = ""): unknown => {
      if (Array.isArray(v)) return v.map((x) => (key === "players" && typeof x === "string" ? this.alias(x) : walk(x)));
      if (v === null || typeof v !== "object") return v;
      const o = v as Record<string, unknown>, game = "worldId" in o;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) {
        const person = k === "accountName" || k === "winner" || (k === "name" && !game);
        out[k] = person && typeof x === "string" ? this.alias(x) : walk(x, k);
      }
      return out;
    };
    return walk(value) as T;
  }
}
