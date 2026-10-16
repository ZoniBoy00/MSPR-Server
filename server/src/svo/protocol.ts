import { createHash } from "node:crypto";
import { MS_MODES } from "./names.js";

/** Response MAC the game verifies: md5(clientMac + "sp9ck0348sld" + 20 x "0"). Matches 68/68 captured pairs. */
export function svoMac(clientMac: string | undefined): string | undefined {
  if (!clientMac || clientMac.length !== 32) return undefined;
  return createHash("md5").update(clientMac + "sp9ck0348sld" + "0".repeat(20), "ascii").digest("hex");
}

/** The game keeps the announcement in a 1024-byte buffer and cuts anything longer than 1023 bytes. Cut here, on a character boundary. */
export function announcementText(text: string, maxBytes = 1023): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8");
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface NpTicket {
  onlineId?: string;
  userId?: string;
  region?: string;
  serviceId?: string;
  /** Signature section owner: "RPCN" for RPCN (RPCS3) tickets, a hex key id for PSN (real PS3) tickets. */
  signer?: string;
}

/** True when the ticket comes from PSN (a real PS3) rather than RPCN (RPCS3). Unknown = RPCN. */
export const isPsnTicket = (t: NpTicket) => !!t.signer && t.signer !== "RPCN";

/** Minimal NP ticket 2.x/3.x reader (as POSTed to ticket/login): 8-byte header, then (u16 type, u16 len) fields. */
export function parseNpTicket(blob: Buffer): NpTicket {
  const out: NpTicket = {};
  try {
    const end = Math.min(blob.length, 8 + blob.readUInt32BE(4));
    let i = 8;
    let inFooter = false;                       // 0x3002 = signature section (signer id, then signature)
    while (i + 4 <= end) {
      const type = blob.readUInt16BE(i);
      const len = blob.readUInt16BE(i + 2);
      i += 4;
      if ((type & 0x3000) === 0x3000) { inFooter = type === 0x3002; continue; } // section header: descend
      const val = blob.subarray(i, i + len);
      i += len;
      if (inFooter) {
        if (type === 8 && !out.signer) out.signer = /^[ -~]+$/.test(val.toString("latin1")) ? val.toString("latin1") : val.toString("hex");
        continue;
      }
      const str = () => val.subarray(0, val.indexOf(0) >= 0 ? val.indexOf(0) : val.length).toString("utf8");
      if (type === 4 && len === 32 && !out.onlineId) out.onlineId = str();
      else if (type === 2 && len === 8 && !out.userId) out.userId = val.readBigUInt64BE(0).toString();
      else if (type === 8 && len === 4 && !out.region) out.region = str();
      else if (type === 8 && len === 24) out.serviceId = str();
    }
  } catch {
    /* truncated ticket: return what we have */
  }
  return out;
}

/** EULA body exactly like the original service: every line indented by 12 spaces inside <text>. */
export function eulaXml(text: string, accepted: boolean): string {
  const lines = text.split("\n").map((l) => "            " + xmlEscape(l)).join("\n");
  return `<XML>\n    <eula>\n        <text>\n${lines}\n        </text>\n        <accepted>${accepted}</accepted>\n    </eula>\n</XML>`;
}

export const STATUS_OK = "<XML>\r\n    <status>\r\n        <id>20407</id>\r\n    </status>\r\n</XML>";

export const URL_LIST: [string, string][] = [
  ["ticketLogin", "https:ticket/login"],
  ["finishGameURI", "/game/finish"],
  ["leaderboard/timeattack", "/motorstormpr/leaderboard/timeattack"],
  ["leaderboard/speed", "/motorstormpr/leaderboard/speed"],
  ["leaderboard/ranked", "/motorstormpr/leaderboard/ranked"],
  ["leaderboard", "/motorstormpr/leaderboard"],
  ["getRegion", "/motorstormpr/getRegion"],
  ["getEula", "/motorstormpr/getEula"],
  ["acceptEula", "/motorstormpr/acceptEula"],
  ["getAnnouncement", "/motorstormpr/getAnnouncement"],
  ["home", "/motorstormpr/home"],
  ["speed-weekend/beaten", "/motorstormpr/speed-weekend/beaten"],
  ["speed-weekend/viewed", "/motorstormpr/speed-weekend/viewed"],
];

export function urlListXml(): string {
  const items = URL_LIST.map(([n, v]) => `        <DATA dataType="URI" name="${n}" value="${v}"/>\r\n`).join("");
  return `<?xml version="1.0" encoding="utf-8"?>\r\n<XML>\r\n    <URL_List>\r\n${items}        <BROWSER_INIT name="init"/>\r\n    </URL_List>\r\n</XML>\r\n`;
}

/** MSPR race times are hundredths of a second (EBOOT 0x2a1be0 prints them as %02d:%02d.%02d): 8048 -> "1:20.48". */
/**
 * Time Attack / offline modes report hundredths of a second, but the online modes (Custom 4, Ranked 5, Casual 6) report
 * milliseconds (e.g. a 2-lap race "bestTime=187326" is 3:07.33), so those are divided by 10 before formatting.
 */
export function raceTimeForMode(mode: unknown, value: number | null | undefined): string {
  const ms = MS_MODES.has(Number(mode));
  return raceTime(ms && typeof value === "number" ? Math.round(value / 10) : value);
}

export function raceTime(cs: number | null | undefined): string {
  if (cs === null || cs === undefined || !Number.isFinite(cs) || cs <= 0) return "";
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** `speed-weekend/beaten` answer: the game's parser (0x2c99b8) reads `beaten_times` > `time` (accountName, account, time, oldTime, track, vehicle). */
export function beatenXml(rows: { accountName: string; account: number; time: number; oldTime: number; track: string; vehicle: string }[]): string {
  const items = rows.map((r) =>
    `        <time accountName="${xmlEscape(r.accountName)}" account="${r.account}" time="${r.time}" oldTime="${r.oldTime}" track="${xmlEscape(r.track)}" vehicle="${xmlEscape(r.vehicle)}"/>\r\n`).join("");
  return `<XML>\r\n    <beaten_times>\r\n${items}    </beaten_times>\r\n</XML>\r\n`;
}
