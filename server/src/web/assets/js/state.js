export var TABS = ["overview", "live", "leaderboards", "drivers", "tracks", "races", "anticheat", "diagnostics", "server", "player"];

export var state = { speedBoards: null, sp: { track: null, vehicle: "0", rows: null }, mm: null, drivers: null, driversQ: "", driversSort: "score", tracks: null, trackId: null, trackDetail: null, anticheat: null, matches: null, matchId: null, match: null, profileMatches: null, lb: "ranked", api: null, summary: null, profile: null, profileName: null, tab: "overview", meta: null, status: null, games: null, players: null, mm: null, boards: null, ranked: null, races: null,
              bans: null, ta: { track: null, vehicle: "0", rows: null }, raceMode: "all", loadedAt: 0, error: null, access: null, diag: null };

/** Whether this viewer may see a section (anticheat, bans, live, raceHistory); everything until /api/access has answered. */
export function can(section) { return !state.access || state.access[section] !== false; }

/** Filled in by main.js so that the modules that load data can ask for a redraw without importing it. */
export var hooks = { render: function () {}, renderModal: function () {} };
