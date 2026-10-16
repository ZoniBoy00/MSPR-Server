/**
 * CPU / RAM / thread usage of the MSPR server processes (for the MSPR Status console).
 *
 * Windows: one long-running PowerShell samples the performance counters every 2 s and prints one JSON line
 * per sample (starting PowerShell once avoids a ~0.5 s process start per refresh). Processes are attributed to
 * a role by their command line: Horizon.exe = Horizon, node "src/index.ts" = the TypeScript server (DNS/SVO/web),
 * node "src/dashboard.ts" = this console. Other platforms report only system totals.
 */
import { spawn } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";

export interface RoleUsage { role: string; cpu: number; memMb: number; threads: number; pids: number[] }
export interface Usage { roles: RoleUsage[]; systemCpu: number | null; systemMemUsedMb: number; systemMemTotalMb: number; at: number }

const SAMPLER = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $cmd = @{}
  Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='Horizon.exe'" | ForEach-Object { $cmd[[int]$_.ProcessId] = $_.CommandLine }
  $p = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name like 'Horizon%' or Name like 'node%'" |
       ForEach-Object { @{ pid = [int]$_.IDProcess; cpu = [double]$_.PercentProcessorTime; mem = [double]$_.WorkingSetPrivate; threads = [int]$_.ThreadCount; cmd = $cmd[[int]$_.IDProcess] } }
  $total = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
  @{ total = [double]$total; procs = @($p) } | ConvertTo-Json -Compress -Depth 4
  Start-Sleep -Seconds 2
}`;

interface Sample { total: number; procs: { pid: number; cpu: number; mem: number; threads: number; cmd: string | null }[] }

function roleOf(cmd: string | null): string | null {
  if (!cmd) return null;
  if (/Horizon\.exe/i.test(cmd)) return "Horizon (Medius + DME)";
  if (/src[\\/]index\.ts/i.test(cmd)) return "server (DNS, SVO, web)";
  if (/src[\\/]dashboard\.ts/i.test(cmd)) return "status console";
  return null;
}

/** Starts sampling; `latest()` returns the newest numbers (null until the first sample arrives). */
export function startResourceMonitor(): { latest: () => Usage | null; stop: () => void } {
  const cores = cpus().length || 1;
  let last: Usage | null = null;
  const system = (): Pick<Usage, "systemMemUsedMb" | "systemMemTotalMb"> => ({
    systemMemUsedMb: Math.round((totalmem() - freemem()) / 2 ** 20),
    systemMemTotalMb: Math.round(totalmem() / 2 ** 20),
  });

  if (process.platform !== "win32") {
    return { latest: () => ({ roles: [], systemCpu: null, ...system(), at: Date.now() }), stop: () => undefined };
  }

  const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SAMPLER], { windowsHide: true });
  let buf = "";
  ps.stdout.setEncoding("utf8");
  ps.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      try {
        const s = JSON.parse(line) as Sample;
        const roles = new Map<string, RoleUsage>();
        for (const p of s.procs ?? []) {
          const role = roleOf(p.cmd);
          if (!role) continue;
          const r = roles.get(role) ?? { role, cpu: 0, memMb: 0, threads: 0, pids: [] };
          r.cpu += p.cpu / cores;                       // counter is per core (0..100 x cores)
          r.memMb += p.mem / 2 ** 20;
          r.threads += p.threads;
          r.pids.push(p.pid);
          roles.set(role, r);
        }
        last = { roles: [...roles.values()], systemCpu: s.total, ...system(), at: Date.now() };
      } catch { /* partial line: ignore */ }
    }
  });
  ps.on("error", () => undefined);
  return { latest: () => last, stop: () => ps.kill() };
}
