/**
 * MSPR Status console: live overview of the whole server in one window (refreshes every 2 s).
 *   npm run dashboard          (Start-MSPRServer.ps1 opens it automatically, -NoDashboard to skip)
 * Shows service ports, CPU / RAM / threads of every server process, online players, games
 * (custom / ranked / casual), matchmaking, latest races and the latest warnings/errors from the logs.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { startResourceMonitor, Usage } from "./resources.js";
import { trackName } from "./svo/names.js";
import { raceTime } from "./svo/protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const HORIZON_LOG = resolve(here, "../../horizon/Servers/Horizon/bin/Release/net6.0/logs/Horizon.log");
const SERVER_TS_LOG = resolve(here, "../../logs/server.log");
const REFRESH_MS = 2000;

const SERVICES: [string, number][] = [
  ["MUIS", 10071], ["MAS", 10075], ["MPS", 10077], ["MLS", 10078], ["MMS", 10079],
  ["DME", 10073], ["SVO", 10060], ["Web", 8080],
];

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", orange: "\x1b[38;5;208m",
};

function portOpen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = createConnection({ host: "127.0.0.1", port, timeout: 500 });
    s.once("connect", () => { s.destroy(); done(true); });
    s.once("error", () => done(false));
    s.once("timeout", () => { s.destroy(); done(false); });
  });
}

async function api<T>(base: string, path: string): Promise<T | null> {
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(1500) });
    return r.ok ? (await r.json()) as T : null;
  } catch {
    return null;
  }
}

/** Last `bytes` of a (possibly large) log file, split into lines. */
function tail(file: string, bytes = 256 * 1024): string[] {
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, "r");
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  return buf.toString("utf8").split(/\r?\n/);
}

interface Problem { time: string; source: string; text: string; level: "warn" | "error" }

function problems(): Problem[] {
  const out: Problem[] = [];
  for (const line of tail(HORIZON_LOG)) {
    const m = /^(\S+)\t(WARN|FAIL|ERROR|CRIT)\t\[Horizon\]\t\[\d+\]\t(.*)$/.exec(line);
    if (!m) continue;
    const text = m[3];
    // routine disconnect noise is not a problem
    if (m[2] === "WARN" && !/TickWatch|MSPR|timed? ?out|failed/i.test(text)) continue;
    out.push({ time: m[1].slice(11, 19), source: "Horizon", text, level: m[2] === "WARN" ? "warn" : "error" });
  }
  for (const line of tail(SERVER_TS_LOG, 64 * 1024))
    if (/error|failed|unknown route|bad query|anticheat/i.test(line) && !/favicon/.test(line))
      out.push({ time: "", source: "server", text: line.trim(), level: /error|failed/i.test(line) ? "error" : "warn" });
  return out.slice(-8);
}

interface Game { worldId: number; name: string; type: string; status: string; host?: string; track: number;
  players: { name: string }[]; minPlayers: number; maxPlayers: number }
interface Bucket { type: string; worldId?: number; reserved: number; waiting: string[]; created: boolean }
interface Status { accounts: number; races: number }
interface Ban { kind: string; value: string; reason: string | null; expires: number | null }
interface Player { name: string; game?: string | null }
interface Race { t: number; name: string; track: string; vehicle: string; bestTimeText: string; gameMode: string;
  trackName: string; vehicleName: string; gameModeName: string; flagged?: string | null }

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const startedAt = Date.now();

function bar(pct: number, width = 20): string {
  const n = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  const col = pct > 80 ? c.red : pct > 50 ? c.yellow : c.green;
  return col + "█".repeat(n) + c.dim + "░".repeat(width - n) + c.reset;
}

function resourceLines(u: Usage | null): string[] {
  const L = [`${c.bold}Resources${c.reset}`];
  if (!u) return [...L, `  ${c.dim}measuring...${c.reset}`];
  for (const r of u.roles)
    L.push(`  ${pad(r.role, 27)} CPU ${bar(r.cpu, 12)} ${r.cpu.toFixed(1).padStart(5)} %   RAM ${String(Math.round(r.memMb)).padStart(5)} MB   threads ${String(r.threads).padStart(4)}`);
  const server = u.roles.filter((r) => r.role !== "status console");   // the console is not part of the server
  const cpu = server.reduce((a, r) => a + r.cpu, 0), mem = server.reduce((a, r) => a + r.memMb, 0);
  if (server.length > 1)
    L.push(`  ${c.bold}${pad("MSPR server total", 27)}${c.reset} CPU ${bar(cpu, 12)} ${cpu.toFixed(1).padStart(5)} %   RAM ${String(Math.round(mem)).padStart(5)} MB`);
  const sysMem = (u.systemMemUsedMb / u.systemMemTotalMb) * 100;
  L.push(`  ${c.dim}${pad("whole computer", 27)}${c.reset} CPU ${bar(u.systemCpu ?? 0, 12)} ${(u.systemCpu ?? 0).toFixed(1).padStart(5)} %   RAM ${(u.systemMemUsedMb / 1024).toFixed(1)} / ${(u.systemMemTotalMb / 1024).toFixed(1)} GB (${sysMem.toFixed(0)} %)`);
  return L;
}

const monitor = startResourceMonitor();

async function render(base: string, lan: string): Promise<string> {
  const [ports, games, mm, status, races, players, bans] = await Promise.all([
    Promise.all(SERVICES.map(async ([n, p]) => [n, p, await portOpen(p)] as const)),
    api<Game[]>(base, "/api/games"),
    api<Bucket[]>(base, "/api/matchmaking"),
    api<Status>(base, "/api/status"),
    api<Race[]>(base, "/api/races?limit=5"),
    api<Player[]>(base, "/api/players"),
    api<Ban[]>(base, "/api/bans"),
  ]);
  const up = Math.floor((Date.now() - startedAt) / 1000);
  const L: string[] = [];
  L.push(`${c.bold}${c.orange}MotorStorm: Pacific Rift — private server${c.reset}  ${c.dim}${new Date().toLocaleTimeString()} · console up ${Math.floor(up / 60)} min${c.reset}`);
  L.push(`${c.dim}Status page http://${lan}:8080/  ·  RPCS3 DNS ${lan}${c.reset}`);
  L.push("");
  L.push(ports.map(([n, p, ok]) => `${ok ? c.green + "●" : c.red + "○"} ${n}${c.dim}:${p}${c.reset}`).join("  "));
  L.push("");
  L.push(...resourceLines(monitor.latest()));
  L.push("");

  const online = Array.isArray(players) ? players : [];
  L.push(`${c.bold}Players online${c.reset} ${online.length}   ${c.dim}accounts ${status?.accounts ?? "?"} · races ${status?.races ?? "?"}${c.reset}`);
  if (online.length) L.push("  " + online.map((p) => p.game ? `${p.name} ${c.dim}(${p.game})${c.reset}` : p.name).join(", "));
  L.push("");

  L.push(`${c.bold}Games${c.reset} ${games ? games.length : c.red + "Horizon not reachable" + c.reset}`);
  for (const g of games ?? []) {
    const col = g.type === "ranked" ? c.yellow : g.type === "casual" ? c.cyan : c.green;
    L.push(`  ${col}${pad(g.type, 7)}${c.reset} ${pad(g.name ?? "?", 22)} world ${String(g.worldId).padEnd(4)} ` +
      `${pad(g.status.replace("World", ""), 16)} ${g.players.length}/${g.maxPlayers}  ` +
      `${g.type === "custom" ? trackName(g.track) : ""} ${c.dim}${g.players.map((p) => p.name).join(", ")}${c.reset}`);
  }
  const waiting = (mm ?? []).filter((b) => b.waiting.length || !b.created);
  if (waiting.length) {
    L.push(`  ${c.dim}matchmaking:${c.reset} ` + waiting.map((b) => `${b.type} ${b.reserved} reserved${b.waiting.length ? ", waiting " + b.waiting.join(", ") : ""}`).join(" · "));
  }
  L.push("");

  L.push(`${c.bold}Latest races${c.reset}`);
  if (!races?.length) L.push(`  ${c.dim}none yet${c.reset}`);
  for (const r of races ?? [])
    L.push(`  ${new Date(r.t * 1000).toLocaleTimeString()}  ${pad(r.name, 16)} ${pad(r.gameModeName, 15)} ${pad(r.trackName, 22)} ${pad(r.vehicleName, 13)} best ${r.bestTimeText || "-"}${r.flagged ? ` ${c.yellow}⚠ ${r.flagged}${c.reset}` : ""}`);
  L.push("");

  if (bans?.length) {
    L.push(`${c.bold}Bans${c.reset} ${bans.length}`);
    for (const b of bans.slice(0, 5))
      L.push(`  ${c.red}${pad(b.kind === "account" ? b.value : "IP", 16)}${c.reset} ${b.reason ?? ""}${b.expires ? ` ${c.dim}until ${new Date(b.expires * 1000).toLocaleString()}${c.reset}` : ""}`);
    L.push("");
  }

  const probs = problems();
  L.push(`${c.bold}Warnings / errors${c.reset} ${c.dim}(Horizon.log, server.log)${c.reset}`);
  if (!probs.length) L.push(`  ${c.green}none${c.reset}`);
  for (const p of probs)
    L.push(`  ${p.level === "error" ? c.red : c.yellow}${p.time.padEnd(8)} ${pad(p.source, 9)}${c.reset} ${pad(p.text, 110)}`);
  L.push("");
  L.push(`${c.dim}Ctrl+C closes this window (the server keeps running). Logs of earlier runs: logs\\archive${c.reset}`);
  return L.join("\n");
}

async function main() {
  const cfg = await loadConfig();
  const base = `http://127.0.0.1:${cfg.web.port}`;
  process.stdout.write("\x1b[?25l");                       // hide cursor
  process.on("SIGINT", () => { monitor.stop(); process.stdout.write("\x1b[?25h\n"); process.exit(0); });
  for (;;) {
    const screen = await render(base, cfg.lanIp);
    process.stdout.write("\x1b[H\x1b[2J" + screen + "\n");
    await new Promise((r) => setTimeout(r, REFRESH_MS));
  }
}

main();
