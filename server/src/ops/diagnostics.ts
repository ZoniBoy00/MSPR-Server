import { createWriteStream, mkdirSync, renameSync, statSync, WriteStream } from "node:fs";
import { dirname } from "node:path";

/**
 * The server's own event journal: what happened to games and players, in one place, so that a fault can be traced
 * afterwards without the players' game logs (part of the players are on a real PS3 and have none).
 *
 * Every event is one JSON line in `data/diagnostics.log` (10 MB, one older copy), the last 500 are kept in memory for
 * the admin-only `/api/diagnostics` and the Diagnostics tab, and each is echoed to the console (the systemd journal).
 * Events carry no IP addresses except `login`, which is why the API is admin only.
 *
 * Kinds: `service` (start), `login`, `horizon` (reachable / unreachable), `game.start`, `game.join`, `game.leave`,
 * `game.end`, `game.summary` (who posted a result and who did not), `result` (a race report arrived), `svo.unknown`,
 * `svo.error`, `anticheat`.
 */
export type Level = "info" | "warn" | "error";
export interface DiagEvent { t: number; kind: string; level: Level; msg: string; data?: Record<string, unknown> }

export class Diagnostics {
  private recent: DiagEvent[] = [];
  private stream?: WriteStream;
  private timer?: NodeJS.Timeout;

  /** @param file JSONL file; without one the journal lives in memory only (tests). @param echo print each event to the console. */
  constructor(private readonly file?: string, private readonly echo = true, private readonly keep = 500) {
    if (!file) return;
    try { mkdirSync(dirname(file), { recursive: true }); this.open(); } catch { this.stream = undefined; }
    this.timer = setInterval(() => this.rotate(), 5 * 60 * 1000);
    this.timer.unref();
  }

  private open(): void {
    this.stream = createWriteStream(this.file!, { flags: "a" });
    this.stream.on("error", () => { this.stream = undefined; });
  }

  private rotate(): void {
    try {
      if (!this.file || statSync(this.file).size < 10 * 1024 * 1024) return;
      this.stream?.end();
      renameSync(this.file, `${this.file}.1`);
      this.open();
    } catch { /* keep writing to the current file */ }
  }

  event(kind: string, msg: string, data?: Record<string, unknown>, level: Level = "info", t = Date.now()): DiagEvent {
    const e: DiagEvent = { t, kind, level, msg, ...(data ? { data } : {}) };
    this.recent.push(e);
    if (this.recent.length > this.keep) this.recent.splice(0, this.recent.length - this.keep);
    try { this.stream?.write(JSON.stringify(e) + "\n"); } catch { /* the journal must never break the server */ }
    if (this.echo) (level === "info" ? console.log : level === "warn" ? console.warn : console.error)(`[diag] ${kind}: ${msg}`);
    return e;
  }

  /** Newest first. */
  list(opts: { limit?: number; kind?: string } = {}): DiagEvent[] {
    const rows = this.recent.filter((e) => !opts.kind || e.kind === opts.kind || e.kind.startsWith(opts.kind + "."));
    return rows.slice(-(opts.limit ?? 200)).reverse();
  }

  close(): void { if (this.timer) clearInterval(this.timer); this.stream?.end(); }
}

/** Real PS3 players log in with their PSN id, RPCS3 players through RPCN. `horizonName` is Horizon's spelling ("name@RPCN" / "name"). */
export function platformOf(horizonName: string): "PS3 (PSN)" | "RPCS3 (RPCN)" {
  return /@RPCN$/i.test(horizonName) ? "RPCS3 (RPCN)" : "PS3 (PSN)";
}

/** The same from the database key ("name" for RPCN, "name@PSN" for a real PS3). */
export const platformOfKey = (key: string) => (/@PSN$/i.test(key) ? "PS3 (PSN)" : "RPCS3 (RPCN)");
