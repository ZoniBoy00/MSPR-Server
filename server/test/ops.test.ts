import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { Store } from "../src/db/store.js";
import { backupOnce } from "../src/ops/maintenance.js";
import { RateLimiter, memo } from "../src/web/ratelimit.js";

describe("rate limiter", () => {
  test("allows up to the limit per window, then refuses, and recovers in the next window", () => {
    const l = new RateLimiter(3, 1000);
    assert.deepEqual([0, 1, 2, 3].map(() => l.allow("1.2.3.4", 100)), [true, true, true, false]);
    assert.equal(l.allow("5.6.7.8", 100), true);          // other addresses are counted separately
    assert.equal(l.allow("1.2.3.4", 1200), true);         // a new window
  });
});

describe("memo", () => {
  test("reuses the value inside the time-to-live", async () => {
    let n = 0;
    const m = memo(50, () => ++n);
    assert.equal(m(), 1);
    assert.equal(m(), 1);
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(m(), 2);
  });
});

describe("database backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "mspr-backup-"));
  const dbFile = join(dir, "live.sqlite");
  const store = new Store(dbFile);
  store.login("Alice", "1");

  test("writes one consistent copy per day and prunes old ones", () => {
    const backups = join(dir, "backups");
    const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
    assert.ok(backupOnce(store, backups, 2, day(1)));
    assert.equal(backupOnce(store, backups, 2, day(1)), null);            // already there today
    backupOnce(store, backups, 2, day(2));
    backupOnce(store, backups, 2, day(3));
    assert.deepEqual(readdirSync(backups).sort(), ["mspr-2026-10-02.sqlite", "mspr-2026-10-03.sqlite"]);
    writeFileSync(join(backups, "notes.txt"), "not a backup");
    backupOnce(store, backups, 2, day(4));
    assert.ok(existsSync(join(backups, "notes.txt")));                      // only mspr-<date>.sqlite files are touched
  });

  test("the copy opens as a database with the same accounts", () => {
    const copy = join(dir, "backups", "mspr-2026-10-04.sqlite");
    const restored = new Store(copy);
    assert.equal(restored.accountByName("alice")?.online_id, "Alice");
    restored.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
