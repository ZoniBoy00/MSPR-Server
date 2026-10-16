import { state } from "../state.js";
import { empty, matchTable, modeChip, panel } from "../ui.js";
import { esc, pad } from "../util.js";

export function viewPlayer() {
  var p = state.profile;
  var h = '<div class="head"><div><h1>' + esc(state.profileName || "Driver") + '</h1><p class="lede"><a href="#leaderboards/ranked">Back to the leaderboards</a></p></div></div>';
  if (state.profile === false) return h + panel("Driver", null, empty("Driver not found", "Nobody with this name has logged in yet."));
  if (!p) return h + panel("Driver", null, empty("Loading", "Fetching the driver profile."));
  var kv = '<div class="kv"><div><b>' + (p.ranked ? "#" + p.ranked.rank : "-") + "</b><span>Ranked position</span></div>" +
    "<div><b>" + (p.ranked ? p.ranked.level : 1) + "</b><span>Rank level</span></div>" +
    "<div><b>" + (p.ranked ? p.ranked.stats.score : 0) + "</b><span>XP</span></div>" +
    "<div><b>" + (p.ranked ? p.ranked.wins : 0) + "</b><span>Ranked wins</span></div>" +
    "<div><b>" + p.byMode.reduce(function (a, m) { return a + m.races; }, 0) + "</b><span>Races</span></div></div>";
  h += panel("Overview" + (p.online ? " · online" + (p.game ? " in " + p.game : "") : ""), null,
    kv + '<div class="legend">' + p.byMode.map(function (m) { return modeChip(m.modeName) + ' <span class="sub">' + m.races + (m.races === 1 ? " race" : " races") + (m.wins ? ", " + m.wins + " won" : "") + "</span>"; }).join(" ") + "</div>");
  var ta = p.timeAttackBests.length ? '<div class="scroll"><table><thead><tr><th>Track</th><th>Vehicle</th><th class="num">Best time</th></tr></thead><tbody>' +
    p.timeAttackBests.map(function (b2) { return "<tr><td>" + esc(b2.trackName) + "</td><td>" + esc(b2.vehicleName) + '</td><td class="num time">' + esc(b2.bestTimeText) + "</td></tr>"; }).join("") + "</tbody></table></div>"
    : empty("No Time Attack times", "Personal bests appear after a Time Attack run.");
  h += panel("Ranked score over time", null, progressBody(p.scoreHistory));
  h += panel("Time Attack bests", null, ta);
  h += panel("Latest races", ["All races", "#races"], matchTable(state.profileMatches || []));
  return h;
}

/* Total XP (the Ranked score) after each scored race. */
export function progressBody(hist) {
  if (!hist || hist.length < 2) return empty("Not enough races yet", "The chart appears after two Ranked races with a score.");
  var W = 640, H = 190, L = 40, R = 14, T = 12, B = 30, n = hist.length, max = hist[n - 1].total;
  var top = Math.max(10, Math.ceil(max / 10) * 10);
  var x = function (i) { return L + (W - L - R) * i / (n - 1); };
  var y = function (v) { return T + (H - T - B) * (1 - v / top); };
  var pts = hist.map(function (h, i) { return x(i).toFixed(1) + "," + y(h.total).toFixed(1); }).join(" ");
  var grid = [0, 0.5, 1].map(function (f) {
    var v = Math.round(top * f);
    return '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + "</text>";
  }).join("");
  var dots = hist.map(function (h, i) {
    return '<circle class="dot" cx="' + x(i).toFixed(1) + '" cy="' + y(h.total).toFixed(1) + '" r="4"><title>Race ' + (i + 1) + ": " + (h.change >= 0 ? "+" : "") + h.change + " = " + h.total + " XP (" + new Date(h.t * 1000).toLocaleString() + ")</title></circle>";
  }).join("");
  var xl = '<text x="' + L + '" y="' + (H - 8) + '">first race</text><text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">race ' + n + "</text>";
  return '<div class="pad"><svg class="spark" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Total XP (Ranked score) after each race">' + grid +
    '<polyline class="line" points="' + pts + '"/>' + dots + xl + '</svg><p class="sub" style="margin:6px 0 0">Total Ranked score after each race. The game also keeps an XP value, which this server cannot read yet.</p></div>';
}

export function loadProfile() {
  var name = encodeURIComponent(state.profileName);
  return Promise.all([
    fetch("/api/player?name=" + name, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : false; }),
    fetch("/api/matches?limit=10&player=" + name, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; })
  ]).then(function (res) { state.profile = res[0]; state.profileMatches = res[1]; }).catch(function () { state.profile = false; });
}
