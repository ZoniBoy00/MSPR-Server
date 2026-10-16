/**
 * Online anti-cheat: everything the server can verify outside the race itself.
 *
 *  1. Game participation. Horizon's /GetMspr/ snapshot is sampled every 5 s and every player's games are
 *     remembered for 30 minutes (world, custom/ranked/casual, players seen). A finishGame report for an online
 *     mode (custom 4, ranked 5, casual 6) is only accepted when the player really was in such a game, and the
 *     reported placing must fit the number of players that game had.
 *  2. Bans. Manual bans (config/bans.txt, read on every check) plus automatic temporary bans after repeated
 *     anti-cheat strikes (antiCheat.autoBanStrikes flagged races within 24 h). A banned player cannot log in
 *     to Medius (Horizon asks /horizon/ban-check), so no online mode is reachable; reports are ignored.
 *  3. Stats audit: the Medius stats blob (XP, rank) is validated and versioned in the database (store.ts).
 *
 * The race itself runs on the players' machines (DME only relays their packets), so in-race cheats such as
 * speed hacks cannot be seen by any server without decoding the game's own packets.
 */
import { readText, Config } from "../config.js";
import { Store } from "../db/store.js";
import { ONLINE_MODES, trackName } from "../svo/names.js";
import { reviewMatch, reviewReport, reviewXp } from "../svo/review.js";
import { Diagnostics, platformOf } from "../ops/diagnostics.js";

/** Horizon names RPCN users "name@RPCN" and PSN users "name"; the database keys them "name" / "name@PSN". */
export const accountKey = (horizonName: string) =>
  /@RPCN$/i.test(horizonName) ? horizonName.replace(/@RPCN$/i, "") : `${horizonName}@PSN`;

interface Participation { worldId: number; type: string; maxPlayersSeen: number; firstSeen: number; lastSeen: number }
interface SnapshotGame { worldId: number; type: string; name?: string; host?: string; track?: number; status?: string; createdUtc?: string; players: { name: string; inGame?: boolean }[] }

/** What the tracker knows about one game it has watched (key = world id + creation time; the name changes when the host leaves). */
interface GameRec {
  key: string; worldId: number; type: string; name: string; host: string; track: number | null; createdUtc: string;
  firstSeen: number; lastSeen: number; endedAt: number | null; maxPlayers: number;
  players: Map<string, { name: string; first: number; last: number; present: boolean }>;
}
/** A race report that reached the SVO service. */
interface ResultNote { t: number; key: string; mode: number; gameId: string; flagged: boolean }

const SUMMARY_DELAY_MS = 20_000;     // results are posted around the time the game ends: wait a little before judging
const GAME_LOG_FROM_MS = 90_000;     // a game that lasted less than this was a lobby, not a race

const MODE_TYPE: Record<number, string> = { 4: "custom", 5: "ranked", 6: "casual" };
const REMEMBER_MS = 30 * 60 * 1000;

export class OnlineTracker {
  private readonly seen = new Map<string, Participation[]>();
  private lastOk = 0;
  private timer?: NodeJS.Timeout;
  private readonly startedAt = Date.now();
  private readonly games = new Map<string, GameRec>();
  private results: ResultNote[] = [];
  private horizonUp: boolean | null = null;

  constructor(private readonly cfg: Config, private readonly diag?: Diagnostics) {}

  start(intervalMs = 5000): void {
    const tick = () => { void this.poll(); };
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }

  /** True when Horizon answered recently (checks are skipped, not failed, while it is unreachable). */
  get healthy(): boolean { return Date.now() - this.lastOk < 30_000; }

  async poll(): Promise<void> {
    try {
      const r = await fetch(`${this.cfg.horizon.crudUrl}/GetMspr/`, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.record(((await r.json()) as { games?: SnapshotGame[] }).games ?? []);
      this.horizonState(true);
    } catch (e) {
      this.horizonState(false, (e as Error).message);     // Horizon down: keep what we have
      this.flush();
    }
  }

  private failures = 0;

  private horizonState(up: boolean, why = ""): void {
    // one missed poll is noise (Horizon is busy or the service just started); report it when it repeats
    this.failures = up ? 0 : this.failures + 1;
    if (!up && this.failures < 2) return;
    if (this.horizonUp === up) return;
    const first = this.horizonUp === null;
    this.horizonUp = up;
    if (up && first) return;                            // not worth an event: the normal start
    this.diag?.event("horizon", up ? "Horizon is reachable" : `Horizon is not answering (${why})`, undefined, up ? "info" : "error");
  }

  /** The SVO service tells the tracker about every race report (who posted what), to compare with who was in the game. */
  noteResult(accountKeyName: string, p: Record<string, string>, flagged: string | null, now = Date.now()): void {
    this.results.push({ t: now, key: accountKeyName.toLowerCase(), mode: Number(p["location.gameMode"]), gameId: p.gameId ?? "", flagged: !!flagged });
    this.results = this.results.filter((x) => now - x.t < REMEMBER_MS);
  }

  /** Feeds one snapshot (exported for tests). */
  record(games: SnapshotGame[], now = Date.now()): void {
    this.lastOk = now;
    this.watch(games, now);
    for (const g of games) {
      for (const p of g.players ?? []) {
        const key = accountKey(p.name).toLowerCase();
        const list = this.seen.get(key) ?? [];
        let entry = list.find((e) => e.worldId === g.worldId && e.type === g.type && now - e.lastSeen < REMEMBER_MS);
        if (!entry) { entry = { worldId: g.worldId, type: g.type, maxPlayersSeen: 0, firstSeen: now, lastSeen: now }; list.push(entry); }
        entry.lastSeen = now;
        entry.maxPlayersSeen = Math.max(entry.maxPlayersSeen, g.players.length);
        this.seen.set(key, list.filter((e) => now - e.lastSeen < REMEMBER_MS));
      }
    }
  }

  /**
   * The wall clock against the report. The tracker saw the driver join the game at `firstSeen`, so a race cannot have
   * lasted longer than the time since then. A report that claims more was made up. Skipped when the driver was first
   * seen right after this process started (a restart in the middle of a race loses the real join time).
   */
  /** Compares each snapshot with the previous one: games starting, players joining and leaving, games ending. */
  private watch(snapshot: SnapshotGame[], now: number): void {
    const live = new Set<string>();
    for (const g of snapshot) {
      const key = `${g.worldId}:${g.createdUtc ?? ""}`;
      live.add(key);
      let rec = this.games.get(key);
      if (!rec) {
        rec = { key, worldId: g.worldId, type: g.type, name: g.name ?? "", host: g.host ?? "", track: g.track ?? null, createdUtc: g.createdUtc ?? "",
          firstSeen: now, lastSeen: now, endedAt: null, maxPlayers: 0, players: new Map() };
        this.games.set(key, rec);
        this.diag?.event("game.start", `${g.type} game ${rec.name} (world ${g.worldId}) opened by ${rec.host.replace(/@RPCN$/i, "")}`, { world: g.worldId, type: g.type, name: rec.name, host: rec.host }, "info", now);
      }
      rec.lastSeen = now; rec.name = g.name ?? rec.name; rec.host = g.host ?? rec.host; rec.track = g.track ?? rec.track;
      rec.maxPlayers = Math.max(rec.maxPlayers, g.players.length);
      const here = new Set<string>();
      for (const p of g.players) {
        const k = p.name.toLowerCase();
        here.add(k);
        let pl = rec.players.get(k);
        if (!pl) {
          pl = { name: p.name, first: now, last: now, present: true };
          rec.players.set(k, pl);
          this.diag?.event("game.join", `${p.name.replace(/@RPCN$/i, "")} joined ${rec.type} game ${rec.name} (${g.players.length} in it)`,
            { world: rec.worldId, type: rec.type, player: p.name, platform: platformOf(p.name), players: g.players.length }, "info", now);
        } else if (!pl.present) { pl.present = true; }
        pl.last = now;
      }
      for (const [k, pl] of rec.players) {
        if (pl.present && !here.has(k)) {
          pl.present = false;
          this.diag?.event("game.leave", `${pl.name.replace(/@RPCN$/i, "")} left ${rec.type} game ${rec.name} after ${Math.round((now - pl.first) / 1000)} s`,
            { world: rec.worldId, type: rec.type, player: pl.name, platform: platformOf(pl.name), seconds: Math.round((now - pl.first) / 1000) }, "info", now);
        }
      }
    }
    for (const [, rec] of this.games) {
      if (!live.has(rec.key) && rec.endedAt === null) {
        rec.endedAt = now;
        this.diag?.event("game.end", `${rec.type} game ${rec.name} ended after ${Math.round((now - rec.firstSeen) / 1000)} s`, { world: rec.worldId, type: rec.type, name: rec.name }, "info", now);
      }
    }
    this.flush(now);
  }

  /** Writes the summary of games that ended a little while ago (also called when Horizon is down). */
  flush(now = Date.now()): void {
    for (const [key, rec] of this.games) {
      if (rec.endedAt === null || now - rec.endedAt < SUMMARY_DELAY_MS) continue;
      this.games.delete(key);
      this.summarize(rec);
    }
  }

  private summarize(rec: GameRec): void {
    const end = rec.endedAt ?? rec.lastSeen;
    const mode = Object.entries(MODE_TYPE).find(([, t]) => t === rec.type)?.[0];
    const seconds = Math.round((end - rec.firstSeen) / 1000);
    const players = [...rec.players.values()].map((pl) => {
      const posted = this.results.filter((x) => x.key === accountKey(pl.name).toLowerCase() && mode !== undefined && x.mode === Number(mode)
        && x.t >= rec.firstSeen && x.t <= end + SUMMARY_DELAY_MS);
      return { name: pl.name, platform: platformOf(pl.name), seconds: Math.round(((pl.present ? end : pl.last) - pl.first) / 1000),
        resultPosted: posted.length > 0, flagged: posted.some((x) => x.flagged) };
    });
    const race = mode !== undefined && (end - rec.firstSeen) >= GAME_LOG_FROM_MS && players.length > 1;
    const missing = players.filter((p) => !p.resultPosted).map((p) => p.name);
    const track = rec.track ? trackName(rec.track) : "no track chosen";
    const nobody = race && missing.length === players.length;
    const msg = `${rec.type} game ${rec.name} on ${track}: ${players.length} players, ${seconds} s; ` +
      (race ? (missing.length ? `NO RESULT from ${missing.map((n) => n.replace(/@RPCN$/i, "")).join(", ")}` : "everyone posted a result") : "too short to be a race") +
      (nobody ? ". Nobody posted a result: the race probably never started. A player who does not own the map (add-on content) can block the start; the host's game chooses the map." : "");
    this.diag?.event("game.summary", msg, { world: rec.worldId, type: rec.type, name: rec.name, track: rec.track, trackName: track, seconds, race, players, missing: race ? missing : [] },
      race && missing.length ? "warn" : "info", end);
  }

  checkTiming(account: string, p: Record<string, string>, now = Date.now()): string | null {
    const mode = Number(p["location.gameMode"]);
    if (!ONLINE_MODES.has(mode) || !this.healthy) return null;
    const raceMs = Number(p.totalRaceTime);
    if (!Number.isFinite(raceMs) || raceMs <= 0) return null;
    const entries = (this.seen.get(account.toLowerCase()) ?? []).filter((e) => e.type === MODE_TYPE[mode] && now - e.lastSeen < REMEMBER_MS);
    if (!entries.length) return null;                        // checkOnlineRace reports a missing game
    const joined = Math.min(...entries.map((e) => e.firstSeen));
    if (joined - this.startedAt < 60_000) return null;
    const elapsed = now - joined;
    if (raceMs > elapsed + 60_000)
      return `race time ${(raceMs / 1000).toFixed(1)} s is longer than the ${(elapsed / 1000).toFixed(1)} s since the player joined the game`;
    return null;
  }

  /** Null for a believable online race report, otherwise the reason it is kept off the leaderboards. */
  checkOnlineRace(account: string, p: Record<string, string>, now = Date.now()): string | null {
    const mode = Number(p["location.gameMode"]);
    if (!ONLINE_MODES.has(mode)) return null;
    if (!this.healthy) return null;                          // cannot verify -> do not punish
    const games = (this.seen.get(account.toLowerCase()) ?? []).filter((e) => now - e.lastSeen < REMEMBER_MS);
    const matching = games.filter((e) => e.type === MODE_TYPE[mode]);
    if (!matching.length)
      return `${MODE_TYPE[mode]} race reported but the player was in no ${MODE_TYPE[mode]} game on the server`;
    const pos = Number(p.position);
    const players = Math.max(...matching.map((e) => e.maxPlayersSeen));
    if (Number.isInteger(pos) && pos >= Math.max(players, 1) + 1)   // 0-based placing, one late joiner tolerated
      return `placing ${pos + 1} in a game of ${players} players`;
    return null;
  }
}

/** Records what looks odd about a stored race (never rejects): the report on its own and against the other drivers' reports. */
export function reviewStored(store: Store, raceId: number, accountId: number, p: Record<string, string>): void {
  for (const f of reviewReport(p)) store.addEvent(accountId, raceId, f.kind, f.detail);
  const m = store.matchOfRace(raceId);
  if (m) for (const f of reviewMatch(m.players)) store.addEvent(f.accountId, raceId, f.kind, f.detail);
  if (m && m.mode === "5") {
    const before = new Map<number, number>();
    for (const x of m.players) { const v = store.xpBefore(x.accountId, m.firstRowId); if (v !== null) before.set(x.accountId, v); }
    for (const f of reviewXp(m.players, before)) store.addEvent(f.accountId, raceId, f.kind, f.detail);
  }
}

/** Manual bans from config/bans.txt: "account <name>" / "ip <address>", optional "# reason". */
function manualBans(file: string): { kind: string; value: string; reason: string }[] {
  return readText(file).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const [main, ...rest] = l.split("#");
    const [kind, ...value] = main.trim().split(/\s+/);
    return { kind: kind.toLowerCase(), value: value.join(" "), reason: rest.join("#").trim() || "banned by the server admin" };
  }).filter((b) => (b.kind === "account" || b.kind === "ip") && b.value);
}

/** Ban decision for a login (Medius) or a report (SVO). `account` is the database key. */
export function banCheck(store: Store, cfg: Config, account: string | null, ip: string | null): { banned: boolean; reason?: string } {
  const plain = account?.replace(/@PSN$/i, "").toLowerCase();
  for (const b of manualBans(cfg.antiCheat.bansFile)) {
    if (b.kind === "ip" && ip && b.value === ip) return { banned: true, reason: b.reason };
    if (b.kind === "account" && account && (b.value.toLowerCase() === account.toLowerCase() || b.value.toLowerCase() === plain))
      return { banned: true, reason: b.reason };
  }
  const hit = (account && store.activeBan("account", account)) || (ip && store.activeBan("ip", ip));
  if (!hit) return { banned: false };
  const until = hit.expires ? ` until ${new Date(hit.expires * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
  return { banned: true, reason: `${hit.reason ?? "banned"}${until}` };
}

/** After a flagged race: a temporary ban once the account reaches antiCheat.autoBanStrikes strikes in 24 h. */
export function strike(store: Store, cfg: Config, accountId: number, accountKeyName: string): boolean {
  const { autoBanStrikes, autoBanHours } = cfg.antiCheat;
  if (!autoBanStrikes || store.flaggedRaceCount(accountId, 24 * 3600) < autoBanStrikes) return false;
  if (store.activeBan("account", accountKeyName)) return false;
  store.addBan("account", accountKeyName, `${autoBanStrikes} anti-cheat strikes within 24 h`, autoBanHours || null);
  return true;
}
