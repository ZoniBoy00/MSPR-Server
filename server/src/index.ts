import { configPath, loadConfig } from "./config.js";
import { Store } from "./db/store.js";
import { startDns } from "./dns/server.js";
import { startSvo } from "./svo/server.js";
import { startWeb } from "./web/server.js";
import { OnlineTracker } from "./online/integrity.js";
import { startBackups } from "./ops/maintenance.js";
import { Diagnostics } from "./ops/diagnostics.js";

// MSPR private server (TypeScript part): SVO + DNS + status web. Medius/DME = Horizon (C#).
const only = new Set(process.argv.slice(2)); // e.g. `npm start -- svo web` (default: all)
const want = (s: string) => only.size === 0 || only.has(s);

const cfg = await loadConfig();
const store = new Store(cfg.database === ":memory:" ? ":memory:" : configPath(cfg.database));
store.ignoreFlags = !cfg.antiCheat.enabled;      // anti-cheat off: old rejection marks no longer hide races
console.log(`[mspr] LAN IP ${cfg.lanIp}, database ${cfg.database}`);

if (want("dns")) startDns(cfg);
// online anti-cheat: remembers who played which game (Horizon snapshot every 5 s) to verify race reports
const diag = new Diagnostics(cfg.database === ":memory:" ? undefined : configPath("../data/diagnostics.log"));
diag.event("service", `server started (${[...(only.size ? only : ["dns", "svo", "web"])].join(", ")})`, { node: process.version });
const tracker = new OnlineTracker(cfg, diag);
if (want("svo")) { tracker.start(); startSvo(cfg, store, configPath("../data/svo_requests.log"), tracker, diag); }
const web = want("web") ? startWeb(cfg, store, diag) : undefined;

// a copy of the database every day (kept for two weeks); only for a file database
if (cfg.database !== ":memory:") startBackups(store, configPath("../data/backups"));

// systemd stops the service with SIGTERM: fold the WAL into the database file before exiting
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[mspr] ${sig}, closing the database`);
    diag.event("service", `server stopping (${sig})`);
    diag.close();
    web?.close();
    try { store.close(); } catch (e) { console.warn(`[mspr] closing the database failed: ${(e as Error).message}`); }
    process.exit(0);
  });
}
