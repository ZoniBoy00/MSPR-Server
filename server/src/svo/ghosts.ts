import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Time Attack ghosts. After a Time Attack race the game posts the ghost (the replay of the best lap) with the result:
 * `POST /finishGame?...&ghostLength=47460` with the ghost as an `application/octet-stream` body.
 *
 * The ghosts are kept, one file per driver, track and vehicle, replaced only by a faster lap. They are served the way
 * the game's own code asks for them (EBOOT 0x2c7c00, 0x2caf88; docs/research/ghosts.md): a Time Attack row says
 * `ghostAvailable="1"` when a ghost is stored, and `GET ghost?location.gameMode=9&location.track=T&location.vehicle=V&account=ID`
 * is answered with `<ghost><data>BASE64</data></ghost>`. The address and the answer are read from the game's code and
 * have not been seen on the wire.
 */
const MAX_GHOST_BYTES = 256 * 1024;

export interface GhostMeta { bestTime: number; t: number; raceId: number }

const base = (dir: string, accountId: number, track: string, vehicle: string) =>
  join(dir, `${accountId}-${track}-${vehicle}`.replace(/[^0-9-]/g, "_"));

/** The stored lap time of a ghost, or null when the driver has none for this track and vehicle. */
export function ghostMeta(dir: string, accountId: number, track: string, vehicle: string): GhostMeta | null {
  try { return JSON.parse(readFileSync(base(dir, accountId, track, vehicle) + ".json", "utf8")) as GhostMeta; }
  catch { return null; }
}

/**
 * Stores a ghost when it fits (the announced length matches the body, at most 256 kB) and beats the driver's stored one.
 * Returns true when the file was written.
 */
export function saveGhost(dir: string, accountId: number, p: Record<string, string>, body: Buffer, raceId: number): boolean {
  const announced = Number(p.ghostLength);
  const bestTime = Number(p.bestTime);
  const track = p["location.track"], vehicle = p["location.vehicle"];
  if (!track || !vehicle || !Number.isInteger(announced) || announced <= 0 || announced !== body.length || body.length > MAX_GHOST_BYTES) return false;
  if (!Number.isFinite(bestTime) || bestTime <= 0) return false;
  const old = ghostMeta(dir, accountId, track, vehicle);
  if (old && old.bestTime <= bestTime) return false;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = base(dir, accountId, track, vehicle);
  writeFileSync(file + ".ghost", body);
  writeFileSync(file + ".json", JSON.stringify({ bestTime, t: Math.floor(Date.now() / 1000), raceId } satisfies GhostMeta));
  return true;
}

/** The stored ghost of a driver on a track and vehicle, or null. */
export function loadGhost(dir: string, accountId: number, track: string, vehicle: string): Buffer | null {
  try { return readFileSync(base(dir, accountId, track, vehicle) + ".ghost"); } catch { return null; }
}

export function hasGhost(dir: string | undefined, accountId: number, track: string, vehicle: string): boolean {
  return !!dir && existsSync(base(dir, accountId, track, vehicle) + ".ghost");
}

/** The answer to a ghost download: the base64 text of the ghost, empty when there is none (the game then says NO GHOST DATA). */
export function ghostXml(ghost: Buffer | null): string {
  return `<XML>\r\n    <ghost>\r\n        <data>${ghost ? ghost.toString("base64") : ""}</data>\r\n    </ghost>\r\n</XML>\r\n`;
}
