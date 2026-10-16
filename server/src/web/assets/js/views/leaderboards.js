import { state } from "../state.js";
import { empty, panel, rankedTable, who } from "../ui.js";
import { esc, fmtCs, get } from "../util.js";

export function viewTimeAttack() {
  var boards = state.boards || [], meta = state.meta || { vehicles: {} };
  if (!boards.length) return panel("Time Attack", null, empty("No lap times yet", "Set a time in Time Attack mode and it is listed here."));
  var cur = state.ta.track;
  var h = '<div class="tabs" role="group" aria-label="Track">' + boards.map(function (t) {
    return '<button type="button" data-track="' + esc(t.track) + '" aria-pressed="' + (t.track === cur) + '">' + esc(t.trackName) + "</button>";
  }).join("") + "</div>";
  h += '<div class="controls"><label for="veh" class="sub">Vehicle</label><select id="veh">' + Object.keys(meta.vehicles).map(function (k) {
    return '<option value="' + k + '"' + (k === state.ta.vehicle ? " selected" : "") + ">" + esc(meta.vehicles[k]) + "</option>";
  }).join("") + "</select></div>";
  var rows = state.ta.rows, body;
  if (!rows) body = empty("Loading", "Fetching the leaderboard.");
  else if (!rows.length) body = empty("Nobody has a time here yet", "Pick another vehicle or set the first lap time.");
  else {
    var lead = rows[0].bestTime;
    body = '<div class="scroll"><table><thead><tr><th>#</th><th>Driver</th><th>Vehicle</th><th class="num">Time</th><th class="num">Gap</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      body += '<tr class="' + (r.rank === 1 ? "top1" : "") + '"><td class="rank">' + r.rank + '</td><td class="name">' + who(r.accountName) + "</td><td>" + esc(r.vehicleName) +
        '</td><td class="num time">' + esc(r.bestTimeText) + '</td><td class="num gap">' + (r.rank === 1 ? "" : "+" + fmtCs(r.bestTime - lead)) + "</td></tr>";
    });
    body += "</tbody></table></div>";
  }
  var tn = (boards.filter(function (t) { return t.track === cur; })[0] || {}).trackName || "";
  return h + panel(tn, null, body);
}

/* Speed and Volcano Weekend: a race against a countdown, ranked by the time left on the clock (more is better). */
export function viewSpeed() {
  var boards = state.speedBoards || [], meta = state.meta || { vehicles: {} };
  if (!boards.length) return panel("Weekend", null, empty("No Weekend times yet", "Race a Speed or Volcano Weekend and the time left on the clock is listed here."));
  var cur = state.sp.track;
  var h = '<div class="tabs" role="group" aria-label="Track">' + boards.map(function (t) {
    return '<button type="button" data-strack="' + esc(t.track) + '" aria-pressed="' + (t.track === cur) + '">' + esc(t.trackName) + "</button>";
  }).join("") + "</div>";
  h += '<div class="controls"><label for="sveh" class="sub">Vehicle</label><select id="sveh">' + Object.keys(meta.vehicles).map(function (k) {
    return '<option value="' + k + '"' + (k === state.sp.vehicle ? " selected" : "") + ">" + esc(meta.vehicles[k]) + "</option>";
  }).join("") + "</select></div>";
  var rows = state.sp.rows, body;
  if (!rows) body = empty("Loading", "Fetching the leaderboard.");
  else if (!rows.length) body = empty("Nobody has a time here yet", "Pick another vehicle or race this track.");
  else {
    var lead = rows[0].timeRemaining;
    body = '<div class="scroll"><table><thead><tr><th>#</th><th>Driver</th><th>Vehicle</th><th class="num">Time left</th><th class="num">Gap</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      body += '<tr class="' + (r.rank === 1 ? "top1" : "") + '"><td class="rank">' + r.rank + '</td><td class="name">' + who(r.accountName) + "</td><td>" + esc(r.vehicleName) +
        '</td><td class="num time">' + esc(r.timeRemainingText) + '</td><td class="num gap">' + (r.rank === 1 ? "" : "-" + fmtCs(Math.round((lead - r.timeRemaining) / 10))) + "</td></tr>";
    });
    body += "</tbody></table></div>";
  }
  var tn = (boards.filter(function (t) { return t.track === cur; })[0] || {}).trackName || "";
  return h + panel(tn, null, body);
}

export function viewLeaderboards() {
  var lb = state.lb === "timeattack" || state.lb === "speed" ? state.lb : "ranked";
  var lede = { ranked: "Ranked standings. Score is the driver's total XP after the latest Ranked race, players beaten is summed over every finished Ranked race.",
    timeattack: "Time Attack: the best lap per driver on each track. Times are shown as minutes:seconds.hundredths.",
    speed: "Speed and Volcano Weekend: a race against the clock. The driver with the most time left on the countdown is first." }[lb];
  var h = '<div class="head"><div><h1>Leaderboards</h1><p class="lede">' + lede + "</p></div>" +
    '<div class="seg" role="group" aria-label="Leaderboard">' +
    '<button type="button" data-lb="ranked" aria-pressed="' + (lb === "ranked") + '">Ranked</button>' +
    '<button type="button" data-lb="timeattack" aria-pressed="' + (lb === "timeattack") + '">Time Attack</button>' +
    '<button type="button" data-lb="speed" aria-pressed="' + (lb === "speed") + '">Weekend</button></div></div>';
  return h + (lb === "ranked" ? panel("Standings", null, rankedTable(state.ranked, 0)) : lb === "timeattack" ? viewTimeAttack() : viewSpeed());
}

export function loadSpeed() {
  if (!state.speedBoards || !state.speedBoards.length) { state.sp.rows = []; return Promise.resolve(); }
  if (!state.speedBoards.some(function (t) { return t.track === state.sp.track; })) state.sp.track = state.speedBoards[0].track;
  return get("/api/leaderboard?kind=speed&track=" + encodeURIComponent(state.sp.track) + "&vehicle=" + encodeURIComponent(state.sp.vehicle))
    .then(function (d) { state.sp.rows = d.rows; });
}

export function loadTA() {
  if (!state.boards || !state.boards.length) { state.ta.rows = []; return Promise.resolve(); }
  if (!state.boards.some(function (t) { return t.track === state.ta.track; })) state.ta.track = state.boards[0].track;
  return get("/api/leaderboard?track=" + encodeURIComponent(state.ta.track) + "&vehicle=" + encodeURIComponent(state.ta.vehicle))
    .then(function (d) { state.ta.rows = d.rows; });
}
