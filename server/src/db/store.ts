import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { statsRollback } from "../svo/review.js";
import { displayName, isRace, placeOf } from "./types.js";
import type { Account, BoardRow, RankedRow, SpeedRow } from "./types.js";
import * as Races from "./races.js";
import * as Matches from "./matches.js";
import * as Anticheat from "./anticheat.js";
import * as People from "./people.js";
export { displayName, placeOf } from "./types.js";
export type { Account, BoardRow, RankedRow, SpeedRow } from "./types.js";

/** The parameters of a module function after its leading store argument. */
type Rest<F> = F extends (s: Store, ...a: infer R) => unknown ? R : never;

export class Store {
  readonly db: DatabaseSync;

  /** Counts stored races; derived data (the match grouping) is recomputed when it changes. */
  raceVersion = 0;
  /**
   * With the anti-cheat off (`antiCheat.enabled=false`) the rejection marks already in the database no longer keep a race
   * off the boards; they stay in the database for reference.
   */
  ignoreFlags = false;

  /** SQL: "the anti-cheat did not reject this race" (`prefix` is a table alias such as "r."). */
  notFlagged(prefix = ""): string { return this.ignoreFlags ? "1=1" : `${prefix}flagged IS NULL`; }


  /** Prepared statements are compiled once and reused (SQL text -> statement). */
  private readonly statements = new Map<string, StatementSync>();

  /** Runs a prepared statement; used by the db modules. */
  q(sql: string): StatementSync {
    let st = this.statements.get(sql);
    if (!st) { st = this.db.prepare(sql); this.statements.set(sql, st); }
    return st;
  }

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        account_id  INTEGER PRIMARY KEY,
        online_id   TEXT NOT NULL UNIQUE COLLATE NOCASE,
        np_user_id  TEXT,
        created     INTEGER NOT NULL,
        last_login  INTEGER NOT NULL,
        eula_hash   TEXT
      );
      CREATE TABLE IF NOT EXISTS races (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        t           INTEGER NOT NULL,
        account_id  INTEGER NOT NULL,
        game_mode   TEXT, track TEXT, vehicle TEXT,
        position    INTEGER, best_time INTEGER, total_time INTEGER,
        end_normal  INTEGER, wrecks INTEGER,
        raw         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS races_track ON races(track, vehicle, best_time);
      CREATE INDEX IF NOT EXISTS races_account ON races(account_id, t);
      CREATE TABLE IF NOT EXISTS anticheat_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, account_id INTEGER NOT NULL, race_id INTEGER,
        kind TEXT NOT NULL, detail TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS anticheat_events_once ON anticheat_events(race_id, account_id, kind) WHERE race_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS races_mode ON races(game_mode, t);
      CREATE TABLE IF NOT EXISTS weekend_views (
        account_id INTEGER NOT NULL, track TEXT NOT NULL, vehicle TEXT NOT NULL, t INTEGER NOT NULL,
        PRIMARY KEY (account_id, track, vehicle)
      );
    `);
    // v2: Medius (Horizon) data lives in the same rows -> one account id for SVO and Medius.
    const cols = (this.q("PRAGMA table_info(accounts)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("medius_stats")) this.db.exec("ALTER TABLE accounts ADD COLUMN medius_stats TEXT");
    // v3: anti-cheat - reason a race is kept off the leaderboards (NULL = clean)
    const raceCols = (this.q("PRAGMA table_info(races)").all() as { name: string }[]).map((c) => c.name);
    if (!raceCols.includes("flagged")) this.db.exec("ALTER TABLE races ADD COLUMN flagged TEXT");
    if (!cols.includes("medius_account")) this.db.exec("ALTER TABLE accounts ADD COLUMN medius_account TEXT");
    // v4: online anti-cheat - bans (manual + automatic) and an audit trail of the Medius stats blob (XP, rank)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bans (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        kind     TEXT NOT NULL,            -- 'account' (database key, e.g. "Name" or "Name@PSN") or 'ip'
        value    TEXT NOT NULL COLLATE NOCASE,
        reason   TEXT,
        created  INTEGER NOT NULL,
        expires  INTEGER                   -- NULL = permanent
      );
      CREATE TABLE IF NOT EXISTS stats_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        t          INTEGER NOT NULL,
        stats      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stats_history_account ON stats_history(account_id, t);
    `);
  }

  /** Accounts Horizon keeps for MSPR (AccountDTO JSON with id/name/stats forced from our columns). */
  mediusAccounts(): Record<string, unknown>[] {
    const rows = this.q("SELECT account_id, online_id, medius_stats, medius_account FROM accounts WHERE medius_account IS NOT NULL").all() as
      { account_id: number; online_id: string; medius_stats: string | null; medius_account: string }[];
    return rows.map((r) => ({ ...JSON.parse(r.medius_account), AccountId: r.account_id, MediusStats: r.medius_stats }));
  }

  /** Horizon created/updated an account: same online id -> same account id as SVO. */
  upsertMediusAccount(dto: Record<string, unknown>): Record<string, unknown> {
    const name = String(dto.AccountName ?? "");
    // Horizon names RPCN users "name@RPCN" and PSN (real PS3) users "name". The database keys RPCN users by
    // their plain name (as before) and PSN users by "name@PSN", so equal names on the two networks stay apart.
    const key = /@RPCN$/i.test(name) ? name.replace(/@RPCN$/i, "") : `${name}@PSN`;
    const acc = this.login(key);
    const stats = typeof dto.MediusStats === "string" ? dto.MediusStats : null;
    this.q("UPDATE accounts SET medius_account = ?, medius_stats = COALESCE(?, medius_stats) WHERE account_id = ?")
      .run(JSON.stringify({ ...dto, AccountName: name }), stats, acc.account_id);
    return { ...dto, AccountId: acc.account_id, AccountName: name };
  }

  /**
   * Stores the Medius stats blob (XP, rank, ranked statistics; base64 of at most 256 bytes) and keeps the last
   * 50 versions per account so tampering can be reviewed and rolled back. Malformed blobs are refused.
   */
  setMediusStats(accountId: number, stats: string): boolean {
    if (typeof stats !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(stats) || Buffer.from(stats, "base64").length > 256)
      return false;
    const before = (this.q("SELECT medius_stats FROM accounts WHERE account_id = ?").get(accountId) as { medius_stats: string | null } | undefined)?.medius_stats;
    const changed = this.q("UPDATE accounts SET medius_stats = ? WHERE account_id = ?").run(stats, accountId).changes > 0;
    if (changed) {
      const now = Math.floor(Date.now() / 1000);
      for (const f of statsRollback(before ? Buffer.from(before, "base64") : null, Buffer.from(stats, "base64"))) this.addEvent(accountId, null, f.kind, f.detail);
      this.q("INSERT INTO stats_history (account_id, t, stats) VALUES (?, ?, ?)").run(accountId, now, stats);
      this.q(`DELETE FROM stats_history WHERE account_id = ? AND id NOT IN
                (SELECT id FROM stats_history WHERE account_id = ? ORDER BY id DESC LIMIT 50)`).run(accountId, accountId);
    }
    return changed;
  }

  statsHistory(accountId: number): { t: number; stats: string }[] {
    return this.q("SELECT t, stats FROM stats_history WHERE account_id = ? ORDER BY id DESC").all(accountId) as { t: number; stats: string }[];
  }

  addBan(kind: "account" | "ip", value: string, reason: string, hours: number | null): void {
    const now = Math.floor(Date.now() / 1000);
    this.q("INSERT INTO bans (kind, value, reason, created, expires) VALUES (?, ?, ?, ?, ?)")
      .run(kind, value, reason, now, hours ? now + Math.round(hours * 3600) : null);
  }

  removeBans(kind: "account" | "ip", value: string): number {
    return Number(this.q("DELETE FROM bans WHERE kind = ? AND value = ?").run(kind, value).changes);
  }

  /** The active ban of an account key or IP, if any. */
  activeBan(kind: "account" | "ip", value: string): { reason: string | null; expires: number | null } | null {
    return (this.q(`SELECT reason, expires FROM bans WHERE kind = ? AND value = ? AND (expires IS NULL OR expires > ?)
                    ORDER BY expires IS NOT NULL, expires DESC LIMIT 1`)
      .get(kind, value, Math.floor(Date.now() / 1000)) as { reason: string | null; expires: number | null } | undefined) ?? null;
  }

  bans(): { kind: string; value: string; reason: string | null; created: number; expires: number | null }[] {
    return this.q("SELECT kind, value, reason, created, expires FROM bans WHERE expires IS NULL OR expires > ? ORDER BY created DESC")
      .all(Math.floor(Date.now() / 1000)) as { kind: string; value: string; reason: string | null; created: number; expires: number | null }[];
  }

  login(onlineId: string, npUserId?: string): Account {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.q("SELECT * FROM accounts WHERE online_id = ?").get(onlineId) as Account | undefined;
    if (existing) {
      this.q("UPDATE accounts SET last_login = ? WHERE account_id = ?").run(now, existing.account_id);
      return { ...existing, last_login: now };
    }
    // the original service handed out ids from 61025 upwards; keep the same range.
    const max = this.q("SELECT MAX(account_id) AS m FROM accounts").get() as { m: number | null };
    const id = Math.max(61025, (max.m ?? 61024) + 1);
    this.q("INSERT INTO accounts (account_id, online_id, np_user_id, created, last_login) VALUES (?, ?, ?, ?, ?)")
      .run(id, onlineId, npUserId ?? null, now, now);
    return this.account(id)!;
  }

  account(id: number): Account | undefined {
    return this.q("SELECT * FROM accounts WHERE account_id = ?").get(id) as Account | undefined;
  }

  setEulaAccepted(id: number, hash: string): void {
    this.q("UPDATE accounts SET eula_hash = ? WHERE account_id = ?").run(hash, id);
  }

  /** Writes a consistent copy of the live database (WAL included) to `file`; the file must not exist yet. */
  backupTo(file: string): void {
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  /** Folds the WAL into the main file and closes the database (used on shutdown). */
  close(): void {
    try { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* already closed */ }
    this.db.close();
  }

  /** Account by display name (case-insensitive; PSN accounts are stored as "name@PSN"). */
  accountByName(name: string): Account | undefined {
    return this.q("SELECT * FROM accounts WHERE online_id = ? OR online_id = ?").get(name, `${name}@PSN`) as Account | undefined;
  }

  /** Every account's stored name (used to resolve a pseudonym back to the account). */
  accountNames(): string[] {
    return (this.q("SELECT online_id FROM accounts").all() as { online_id: string }[]).map((r) => r.online_id);
  }

  stats() {
    const accounts = (this.q("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
    const races = (this.q("SELECT COUNT(*) AS n FROM races").get() as { n: number }).n;
    const recent = this.q(`
      SELECT r.t, a.online_id AS name, r.game_mode, r.track, r.vehicle, r.position, r.best_time, r.flagged, r.raw
      FROM races r JOIN accounts a ON a.account_id = r.account_id WHERE COALESCE(r.track, '') <> '999' AND ${isRace("r.")} ORDER BY r.id DESC LIMIT 20`).all()
      .map((r) => ({ ...r, name: displayName(String(r.name)), place: placeOf(String(r.raw), r.position as number | null), raw: undefined }));
    return { accounts, races, matches: Matches.matchClusters(this).length, recent };
  }

  // ---- the rest lives in races.ts, matches.ts, anticheat.ts and people.ts; these keep the Store API in one place

  /** Races an account reported during the last `seconds` (anti-cheat rate check). */
  recentRaceCount(...a: Rest<typeof Races.recentRaceCount>) { return Races.recentRaceCount(this, ...a); }
  addRace(...a: Rest<typeof Races.addRace>) { return Races.addRace(this, ...a); }
  /** Best time per player on a track (vehicle "0" = any vehicle), ascending. */
  board(...a: Rest<typeof Races.board>) { return Races.board(this, ...a); }
  /**
   * Ranked board: per player the latest `score` (total XP) and the SUM of every other requested stat over all clean Ranked
   * races, highest score first. Stat names are the `stat.*` query keys of the game's request.
   */
  rankedBoard(...a: Rest<typeof Races.rankedBoard>) { return Races.rankedBoard(this, ...a); }
  xpBefore(...a: Rest<typeof Races.xpBefore>) { return Races.xpBefore(this, ...a); }
  /** Finished races with optional filters, newest first, plus the unpaged total. Online modes: 4 custom, 5 ranked, 6 casual. */
  racesFiltered(...a: Rest<typeof Races.racesFiltered>) { return Races.racesFiltered(this, ...a); }
  /** Best Time Attack lap per track and vehicle (all vehicles of a track, not only the overall record). */
  records(...a: Rest<typeof Races.records>) { return Races.records(this, ...a); }
  /** Server-wide activity: races per mode, per day (last 14 days), busiest tracks and most active drivers. */
  summary(...a: Rest<typeof Races.summary>) { return Races.summary(this, ...a); }
  /** Tracks that have finished races, with the number of players on each (for /api/leaderboards). */
  tracks(...a: Rest<typeof Races.tracks>) { return Races.tracks(this, ...a); }
  /** Speed / Volcano Weekend board: most time left first. */
  speedBoard(...a: Rest<typeof Races.speedBoard>) { return Races.speedBoard(this, ...a); }
  /** Tracks with Speed / Volcano Weekend races. */
  speedTracks(...a: Rest<typeof Races.speedTracks>) { return Races.speedTracks(this, ...a); }
  /** Weekend times of other drivers that beat this driver's best since the driver's race or last look at the board. */
  weekendBeaten(...a: Rest<typeof Races.weekendBeaten>) { return Races.weekendBeaten(this, ...a); }
  /** The driver has looked at the Weekend board of a track and vehicle: those beaten notices are done. */
  weekendViewed(...a: Rest<typeof Races.weekendViewed>) { return Races.weekendViewed(this, ...a); }
  /** Removes the e2e self-test's races (track 999). */
  deleteTestRaces(...a: Rest<typeof Races.deleteTestRaces>) { return Races.deleteTestRaces(this, ...a); }
  /** Matches, newest first, optionally only those of one mode or one driver; `total` is the unpaged count. */
  matches(...a: Rest<typeof Matches.matches>) { return Matches.matches(this, ...a); }
  /** The match a race report (row id) belongs to. */
  matchOfRace(...a: Rest<typeof Matches.matchOfRace>) { return Matches.matchOfRace(this, ...a); }
  /** One match with every player's report, or undefined for an unknown id. */
  match(...a: Rest<typeof Matches.match>) { return Matches.match(this, ...a); }
  /** Records a finding for the Anti-cheat page (never rejects a race). */
  addEvent(...a: Rest<typeof Anticheat.addEvent>) { return Anticheat.addEvent(this, ...a); }
  /** Everything the anti-cheat has noticed: rejected races, findings to review, and the totals. */
  anticheatOverview(...a: Rest<typeof Anticheat.anticheatOverview>) { return Anticheat.anticheatOverview(this, ...a); }
  /** Flagged (anti-cheat) races of an account within the last `seconds`. */
  flaggedRaceCount(...a: Rest<typeof Anticheat.flaggedRaceCount>) { return Anticheat.flaggedRaceCount(this, ...a); }
  /** Drivers with their activity; `q` filters by name. Sorted by Ranked score, race count, recent activity or name. */
  drivers(...a: Rest<typeof People.drivers>) { return People.drivers(this, ...a); }
  /** Per-player summary: race counts by mode, Ranked totals, Time Attack personal bests and the latest races. */
  playerProfile(...a: Rest<typeof People.playerProfile>) { return People.playerProfile(this, ...a); }
  /** Per track: how often it was raced, by how many drivers and in which modes and vehicles, and the Time Attack record. */
  trackSummaries(...a: Rest<typeof People.trackSummaries>) { return People.trackSummaries(this, ...a); }
}
