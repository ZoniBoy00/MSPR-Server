/**
 * Display names for the numbers the game reports (finishGame, leaderboards). Reverse engineered from EBOOT v1.03:
 *
 * Track (`location.track`): the game's own track id. Lookup function 0x1e57d0: ids 1..16 index the base-game
 *   table at 0xf254e8, ids 17..30 the table at 0xf25408 (16-byte entries {?, name, file, flags}).
 * Vehicle (`location.vehicle`): vehicle class + 1 (0x2c20f8: class < 8 ? class + 1 : 0), 0 = any class.
 *   Classes in weight order (vehicle-class string tables "AnyClass, ..., MonsterTruck").
 * Game mode (`location.gameMode`): the GameTypeSet* order (Festival = 1 ... TimeTrial = 9). Confirmed by
 *   real reports: Time Attack = 9 (2026-10-15), an online custom race = 4 (the original service capture 2026-10-12),
 *   and a Ranked match left 5 in the custom game settings. 11 is the Speed Weekend (a real race, 2026-10-16); 10, the Volcano Weekend, is inferred.
 */
export const TRACKS: Record<number, string> = {
  1: "Kanaloa Bay", 2: "Sugar Rush", 3: "Mudslide", 4: "Cascade Falls", 5: "Beachcomber",
  6: "Colossus Canyon", 7: "Caldera Ridge", 8: "Badlands", 9: "The Edge", 10: "Paradise Beach",
  11: "The Rift", 12: "Scorched", 13: "Razorback", 14: "Rain God Spires", 15: "Wildfire", 16: "Riptide",
  17: "Reef Runner", 18: "Quick Sands", 19: "Brimstone", 20: "Engorged", 21: "Hollowed Earth",
  22: "Darkfire Swamp", 23: "Caldera Ridge Volcanic", 24: "The Edge Volcanic", 25: "Hollowed Earth Volcanic",
  26: "The Rift Volcanic", 27: "Badlands Volcanic", 28: "Scorched Volcanic", 29: "Mudslide Volcanic",
  30: "Wildfire Volcanic",
};

export const VEHICLES: Record<number, string> = {
  0: "Any vehicle", 1: "Bike", 2: "ATV", 3: "Buggy", 4: "Rally Car", 5: "Racing Truck",
  6: "Mudplugger", 7: "Big Rig", 8: "Monster Truck",
};

export const GAME_MODES: Record<number, string> = {
  1: "Festival", 2: "Free Play", 3: "Split Screen", 4: "Online (custom)", 5: "Ranked", 6: "Casual",
  7: "Demo", 8: "Demo split screen", 9: "Time Attack", 10: "Volcano Weekend", 11: "Speed Weekend",
};

/** Game modes raced against other players over Medius/DME. */
export const ONLINE_MODES = new Set([4, 5, 6]);

/**
 * Modes whose race reports carry milliseconds: the online modes and the Speed / Volcano Weekend (10, 11). Every other
 * mode, Time Attack (9) included, reports hundredths of a second.
 */
export const MS_MODES = new Set([4, 5, 6, 10, 11]);
/** Volcano Weekend (10) and Speed Weekend (11): a race against a countdown. `bestTime` is the time left, more is better. */
export const SPEED_MODES = new Set([10, 11]);
/** Time Attack: the only mode the Time Attack boards are made of. */
export const TIME_ATTACK_MODE = 9;

const lookup = (table: Record<number, string>, v: unknown, unknown: string) => {
  const n = Number(v);
  return Number.isInteger(n) && table[n] !== undefined ? table[n] : `${unknown} ${v ?? "?"}`;
};
export const trackName = (v: unknown) => lookup(TRACKS, v, "Track");
export const vehicleName = (v: unknown) => lookup(VEHICLES, v, "Vehicle");
export const gameModeName = (v: unknown) => lookup(GAME_MODES, v, "Mode");
