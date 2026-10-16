import { state } from "./state.js";
import { empty, placeBadge, who } from "./ui.js";
import { ago, esc, fmtMs, km } from "./util.js";

/* ---------- race details dialog ---------- */
export function modalHtml() {
  var m = state.match;
  var head = function (title, sub) {
    return '<div class="dlg-head"><div><h2>' + title + "</h2>" + (sub ? '<div class="sub">' + sub + "</div>" : "") +
      '</div><button class="dlg-close" type="button" data-close aria-label="Close">&times;</button></div>';
  };
  if (m === false) return head("Race not found", "") + '<div class="dlg-body">' + empty("This race does not exist", "The link may be old or the id is wrong.") + "</div>";
  if (!m) return head("Race #" + state.matchId, "") + '<div class="dlg-body">' + empty("Loading", "Fetching the race.") + "</div>";
  var ps = m.players, online = ["Ranked", "Casual", "Online (custom)"].indexOf(m.modeName) >= 0;
  var speed = m.modeName === "Speed Weekend" || m.modeName === "Volcano Weekend";
  var any = function (k) { return ps.some(function (x) { return x[k] != null && x[k] !== 0; }); };
  var winner = ps.filter(function (x) { return x.place === 1; })[0];
  var second = ps.filter(function (x) { return x.place === 2; })[0];
  var lead = "";
  if (speed && ps[0]) {
    lead = "<b>" + esc(ps[0].name) + "</b> finished with <b>" + esc(ps[0].timeRemainingText || "-") + "</b> left on the clock after a race of <b>" + esc(ps[0].timeText || "-") + "</b>.";
  } else if (winner) {
    lead = "<b>" + esc(winner.name) + "</b> won" + (winner.timeText ? " in <b>" + esc(winner.timeText) + "</b>" : "");
    if (online && second && winner.totalTime && second.totalTime) lead += ", " + fmtMs(second.totalTime - winner.totalTime) + " ahead of " + esc(second.name);
    lead += ".";
  }
  var cols = [["Place", function (x) { return placeBadge(x.place); }, ""], ["Driver", function (x) { return '<span class="name">' + who(x.name) + "</span>"; }, ""],
    ["Vehicle", function (x) { return esc(x.vehicleName); }, ""], [online ? "Race time" : "Lap time", function (x) { return esc(x.timeText || "-"); }, "num time"]];
  if (speed) {
    cols = cols.filter(function (c) { return c[0] !== "Place"; });
    cols[cols.length - 1] = ["Race time", function (x) { return esc(x.timeText || "-"); }, "num time"];
    cols.push(["Time left", function (x) { return esc(x.timeRemainingText || "-"); }, "num time"]);
  }
  if (online && any("timeInFirst")) cols.push(["Time in 1st", function (x) { return esc(x.timeInFirstText || "-"); }, "num time"]);
  if (any("score")) cols.push(["Score", function (x) { return x.score == null ? "" : x.score; }, "num"]);
  if (any("playersBeaten") || any("playersBeatenBy")) cols.push(["Beat / beaten by", function (x) { return (x.playersBeaten || 0) + " / " + (x.playersBeatenBy || 0); }, "num"]);
  if (any("wrecks")) cols.push(["Wrecks", function (x) { return x.wrecks == null ? "" : x.wrecks; }, "num"]);
  if (any("distance")) cols.push(["Distance", function (x) { return km(x.distanceKm); }, "num"]);
  if (any("boostDistance")) cols.push(["Boost", function (x) { return km(x.boostKm); }, "num"]);
  if (any("jumps")) cols.push(["Jumps", function (x) { return x.jumps == null ? "" : x.jumps + (x.furthestJumpKm ? " (best " + x.furthestJumpKm.toFixed(2) + " km)" : ""); }, "num"]);
  var table = '<div class="scroll"><table><thead><tr>' + cols.map(function (c) { return '<th class="' + (c[2] ? "num" : "") + '">' + c[0] + "</th>"; }).join("") + "</tr></thead><tbody>" +
    ps.map(function (x) {
      return "<tr>" + cols.map(function (c) { return '<td class="' + c[2] + '">' + c[1](x) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody></table></div>";
  var facts = '<div class="facts"><div><b>' + esc(m.trackName) + "</b><span>Track</span></div><div><b>" + esc(m.modeName === "Online (custom)" ? "Custom Game" : m.modeName) + "</b><span>Mode</span></div>" +
    "<div><b>" + (m.laps == null ? "-" : m.laps) + "</b><span>Laps</span></div><div><b>" + m.playerCount + "</b><span>" + (m.playerCount === 1 ? "Driver" : "Drivers") + "</span></div>" +
    "<div><b>" + esc(new Date(m.t * 1000).toLocaleString()) + "</b><span>Finished</span></div></div>";
  return head("Race #" + m.id + " · " + esc(m.trackName), esc(m.modeName === "Online (custom)" ? "Custom Game" : m.modeName) + " · " + esc(ago(m.t))) +
    '<div class="dlg-body">' + facts + (lead ? '<p class="lead">' + lead + "</p>" : "") + table +
    '<p class="sub" style="margin:0">Times come from each driver\'s own report to the server. Distances are what the game counted for that driver.</p></div>';
}

export function renderModal() {
  var dlg = document.getElementById("race-dialog");
  if (state.matchId == null) { if (dlg.open) dlg.close(); return; }
  var html = modalHtml();
  if (dlg.getAttribute("data-html") !== html) { dlg.innerHTML = html; dlg.setAttribute("data-html", html); }   // keep scroll and selection between refreshes
  if (!dlg.open && dlg.showModal) dlg.showModal();
}

export function loadMatch() {
  var id = state.matchId;
  return fetch("/api/match?id=" + encodeURIComponent(id), { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : false; }).catch(function () { return false; })
    .then(function (d) { if (state.matchId === id) state.match = d; });
}
