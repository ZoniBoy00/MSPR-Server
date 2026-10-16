import { loadMatch } from "./modal.js";
import { can, hooks, state } from "./state.js";
import { get } from "./util.js";
import { loadDrivers } from "./views/drivers.js";
import { loadSpeed, loadTA } from "./views/leaderboards.js";
import { loadProfile } from "./views/player.js";
import { loadTrack } from "./views/tracks.js";

/* what only one tab needs */
export function extras() {
  var j = [];
  if (state.tab === "live" && can("live")) j.push(get("/api/matchmaking").then(function (d) { state.mm = d.error ? [] : d; }));
  if (state.tab === "drivers") j.push(loadDrivers());
  if (state.tab === "leaderboards" && state.lb === "speed") j.push(get("/api/leaderboards?kind=speed").then(function (d) { state.speedBoards = d; }).then(loadSpeed));
  if (state.tab === "tracks") { j.push(get("/api/tracks").then(function (d) { state.tracks = d; })); if (state.trackId) j.push(loadTrack()); }
  if (state.tab === "diagnostics" && can("diagnostics")) j.push(get("/api/diagnostics").then(function (d) { state.diag = d; }));
  if (state.tab === "anticheat" && can("anticheat")) j.push(get("/api/anticheat").then(function (d) { state.anticheat = d; }));
  return j;
}

export function refresh() {
  if (!state.access) return get("/api/access").then(function (a) { state.access = a; }, function () { state.access = null; }).then(function () { return state.access ? refresh() : load(); });
  return load();
}

function load() {
  var jobs = [
    get("/api/status").then(function (d) { state.status = d; }),
    can("live") ? get("/api/games").then(function (d) { state.games = d.error ? [] : d; }) : Promise.resolve(),
    get("/api/ranked").then(function (d) { state.ranked = d; }),
    can("raceHistory") ? get("/api/matches?limit=100").then(function (d) { state.matches = d; }) : Promise.resolve(),
    get("/api/leaderboards").then(function (d) { state.boards = d; }).then(loadTA),
    can("bans") ? get("/api/bans").then(function (d) { state.bans = d; }) : Promise.resolve(),
    get("/api/summary").then(function (d) { state.summary = d; })
  ];
  jobs = jobs.concat(extras());
  if (!state.api) jobs.push(get("/api").then(function (d) { state.api = d; }));
  if (state.tab === "player" && state.profileName) jobs.push(loadProfile());
  if (!state.meta) jobs.push(get("/api/meta").then(function (d) { state.meta = d; }));
  if (state.matchId !== null && state.match) jobs.push(loadMatch());
  return Promise.all(jobs).then(function () { state.error = null; state.loadedAt = Date.now(); })
    .catch(function (e) { state.error = e.message; }).then(function () { hooks.render(); hooks.renderModal(); });
}
