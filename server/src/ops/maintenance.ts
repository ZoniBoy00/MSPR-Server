import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../db/store.js";

const BACKUP_NAME = /^mspr-(\d{4}-\d{2}-\d{2})\.sqlite$/;
const day = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Makes sure today's database backup exists and deletes the ones older than `keep` days.
 * `VACUUM INTO` writes a consistent single-file copy of the live database, WAL included, without stopping the server.
 * Returns the file written, or null when today's backup was already there.
 */
export function backupOnce(store: Store, dir: string, keep = 14, now = new Date()): string | null {
  mkdirSync(dir, { recursive: true });
  const names = readdirSync(dir).filter((n) => BACKUP_NAME.test(n)).sort();
  const today = `mspr-${day(now)}.sqlite`;
  let written: string | null = null;
  if (!names.includes(today)) {
    written = join(dir, today);
    store.backupTo(written);
    names.push(today);
  }
  for (const old of names.slice(0, Math.max(0, names.length - keep))) rmSync(join(dir, old), { force: true });
  return written;
}

/** Daily database backups: one at start-up if today's is missing, then a check every 6 hours. */
export function startBackups(store: Store, dir: string, keep = 14): NodeJS.Timeout {
  const run = () => {
    try {
      const f = backupOnce(store, dir, keep);
      if (f) console.log(`[backup] database copied to ${f}`);
    } catch (e) {
      console.warn(`[backup] failed: ${(e as Error).message}`);
    }
  };
  run();
  const t = setInterval(run, 6 * 3600 * 1000);
  t.unref();
  return t;
}
