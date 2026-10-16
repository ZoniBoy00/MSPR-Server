import { state } from "./state.js";
import { esc, ordinal, when } from "./util.js";

export function modeChip(name) {
  var cls = name === "Ranked" ? "ranked" : name === "Casual" ? "casual" : "";
  return '<span class="chip ' + cls + '">' + esc(name === "Online (custom)" ? "Custom Game" : name) + "</span>";
}

export function placeBadge(p) {
  if (p == null) return '<span class="sub">-</span>';
  return '<span class="place p' + (p <= 3 ? p : "n") + '">' + ordinal(p) + "</span>";
}

export function who(n) { return '<a href="#player/' + encodeURIComponent(n) + '">' + esc(n) + "</a>"; }

export function empty(title, text) { return '<div class="empty"><b>' + esc(title) + "</b>" + esc(text) + "</div>"; }

export function panel(title, link, body) {
  return '<section class="panel"><header><h2>' + esc(title) + "</h2>" + (link ? '<a href="' + link[1] + '">' + esc(link[0]) + "</a>" : "") + "</header>" + body + "</section>";
}

/* shown instead of a section the server keeps back from this viewer */
export function restricted(title, what) {
  return '<div class="head"><div><h1>' + esc(title) + "</h1></div></div>" + panel(title, null, empty("Restricted", what + " is only shown to the server admin. Enter the admin token on the Server tab to see it."));
}

export function resultChips(m) {
  var ps = m.players.slice(0, 3).map(function (pl) {
    return '<span class="res">' + placeBadge(pl.place) + " " + who(pl.name) + "</span>";
  }).join("");
  return ps + (m.players.length > 3 ? '<span class="sub">+' + (m.players.length - 3) + " more</span>" : "");
}

export function matchTable(rows) {
  if (!rows || !rows.length) return empty("No races yet", "Finished races show up here as soon as the game reports them.");
  var h = '<div class="scroll"><table><thead><tr><th>Race</th><th>When</th><th>Mode</th><th>Track</th><th class="num">Laps</th><th>Result</th><th class="num">Winning time</th></tr></thead><tbody>';
  rows.forEach(function (m) {
    var win = m.players.filter(function (x) { return x.place === 1; })[0] || m.players[0];
    h += '<tr class="click" data-race="' + m.id + '"><td><a class="rid" href="#races/' + m.id + '">#' + m.id + "</a></td><td>" + when(m.t) + "</td><td>" + modeChip(m.modeName) + "</td><td>" +
      esc(m.trackName) + '</td><td class="num">' + (m.laps == null ? "-" : m.laps) + "</td><td>" + resultChips(m) + '</td><td class="num time">' + esc(win ? (win.timeRemainingText ? win.timeRemainingText + " left" : win.timeText || "-") : "-") +
      "</td></tr>";
  });
  return h + "</tbody></table></div>";
}

export function rankedTable(rows, limit) {
  if (!rows || !rows.length) return empty("No ranked results yet", "Finish a Ranked race and the standings appear here.");
  var list = limit ? rows.slice(0, limit) : rows;
  var h = '<div class="scroll"><table><thead><tr><th>#</th><th>Player</th><th class="num">Level</th><th class="num">XP</th><th class="num">Beaten</th>' +
    (limit ? "" : '<th class="num">Wins</th><th class="num">Races</th>') + "</tr></thead><tbody>";
  list.forEach(function (r) {
    h += '<tr class="' + (r.rank === 1 ? "top1" : "") + '"><td class="rank">' + r.rank + '</td><td class="name">' + who(r.accountName) + '</td><td class="num">' + r.level + '</td><td class="num time">' + (r.stats.score || 0) +
      '</td><td class="num">' + (r.stats.playersBeaten || 0) + "</td>" + (limit ? "" : '<td class="num">' + r.wins + '</td><td class="num">' + r.races + "</td>") + "</tr>";
  });
  return h + "</tbody></table></div>";
}

export function raceLink(id) { return id == null ? '<span class="sub">-</span>' : '<a class="rid" href="#races/' + id + '">#' + id + "</a>"; }

export function trackLabel(id) { return state.meta && state.meta.tracks && state.meta.tracks[id] ? state.meta.tracks[id] : "Track " + id; }

export var MODE_CLASS = { "Ranked": "ranked", "Casual": "casual", "Online (custom)": "custom", "Time Attack": "ta" };

export var MODE_LABEL = { "Online (custom)": "Custom Game" };

export function modeKey(name) { return MODE_CLASS[name] || "other"; }

export function modeLabel(name) { return MODE_LABEL[name] || name; }
