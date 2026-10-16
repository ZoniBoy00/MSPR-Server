import { readFileSync } from "node:fs";
import { createSocket } from "node:dgram";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AntiCheatConfig, DEFAULT_ANTICHEAT } from "./svo/anticheat.js";
import { DEFAULT_PRIVACY, Privacy } from "./web/privacy.js";

export interface Config {
  lanIp: string;
  /** Address handed to players (DNS answers). Set for internet hosting, otherwise = lanIp. */
  publicIp: string | null;
  svo: {
    /** Host in the SVO URL handed to the game. "auto" = the advertised IP (recommended: the game's SVO
     *  HTTP client then skips its own one-slot DNS resolver, which wedges for the rest of the game session
     *  after a single failed lookup). A hostname works too; our DNS answers it. */
    host: string;
    port: number;
    region: { id: number; mediusLocation: string };
    eulaFile: string;
    announcementFile: string;
    /** true = the game shows the EULA on every login (the original service behaviour). */
    eulaAlwaysShow: boolean;
    /** true = an SVO login whose NP ticket signature is wrong is refused (default false: only logged, see svo/ticket.ts). */
    requireSignedTickets?: boolean;
  };
  dns: { port: number; upstream: string; localNames: string[]; localSuffixes: string[]; forwardNames?: string[] };
  /** `adminToken`: secret that unlocks the restricted parts of the site and API for a remote viewer (null = only the server's own machine). */
  web: { port: number; adminToken?: string | null; privacy?: Partial<Privacy> };
  horizon: { crudUrl: string; appId: number };
  database: string;
  leaderboards: { timeattackModes: string[] | null; speedModes: string[] | null };
  antiCheat: AntiCheatConfig;
}

export const CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "config");

/** Path relative to the config directory (EULA, announcement, database ...). */
export function configPath(p: string): string {
  return resolve(CONFIG_DIR, p);
}

export async function detectLanIp(): Promise<string> {
  return new Promise((done) => {
    const s = createSocket("udp4");
    s.on("error", () => done("127.0.0.1"));
    s.connect(80, "1.1.1.1", () => {
      const ip = s.address().address;
      s.close();
      done(ip);
    });
  });
}

export async function loadConfig(file = configPath("mspr.json")): Promise<Config> {
  const cfg = JSON.parse(readFileSync(file, "utf8")) as Config;
  if (!cfg.lanIp || cfg.lanIp === "auto") cfg.lanIp = await detectLanIp();
  cfg.svo.host ||= "auto";
  cfg.antiCheat = { ...DEFAULT_ANTICHEAT, ...(cfg.antiCheat ?? {}) }; // configs from older packages have none // configs from older packages have no svo.host
  cfg.web.privacy = { ...DEFAULT_PRIVACY, ...(cfg.web.privacy ?? {}) };
  if (process.env.MSPR_ADMIN_TOKEN) cfg.web.adminToken = process.env.MSPR_ADMIN_TOKEN;
  if (process.env.MSPR_PUBLIC_IP) cfg.publicIp = process.env.MSPR_PUBLIC_IP;
  if (process.env.MSPR_SVO_PORT) cfg.svo.port = Number(process.env.MSPR_SVO_PORT);
  if (process.env.MSPR_DB) cfg.database = process.env.MSPR_DB;
  return cfg;
}

/** The IP the game should connect to (public when hosting for the internet). */
export function advertisedIp(cfg: Config): string {
  return cfg.publicIp || cfg.lanIp;
}

/** Text files (EULA, announcement) are re-read on every request so edits apply instantly. */
export function readText(p: string): string {
  try {
    return readFileSync(configPath(p), "utf8").replace(/\r\n/g, "\n").trimEnd();
  } catch {
    return "";
  }
}
