import { can, state } from "../state.js";
import { empty, matchTable, modeChip, modeKey, modeLabel, panel, rankedTable } from "../ui.js";
import { esc, pad } from "../util.js";

/* ---------- views ---------- */
export function viewOverview() {
  var s = state.status || {}, on = (s.online && s.online.players) || [], games = state.games || [];
  var h = '<div class="head"><div><h1>Race control</h1><p class="lede">Live lobbies, standings and the latest results from the private MotorStorm: Pacific Rift server.</p></div></div>';
  h += '<div class="stats"><div class="stat"><b>' + on.length + "</b><span>Online now</span></div><div class=\"stat\"><b>" + games.length + "</b><span>Live games</span></div>" +
       '<div class="stat"><b>' + (s.matches != null ? s.matches : s.races || 0) + "</b><span>Races run</span></div><div class=\"stat\"><b>" + (s.accounts || 0) + "</b><span>Drivers</span></div></div>";

  var live = "";
  if (games.length) {
    live += '<div class="rows">';
    games.forEach(function (g) {
      var names = (g.players || []).map(function (p) { return p.name.replace(/@RPCN$/, ""); });
      live += '<div class="row"><div class="grow"><div class="name">' + esc(g.name) + '</div><div class="sub">' + (names.length ? esc(names.join(", ")) : "empty") +
        '</div></div><div>' + modeChip(g.type.charAt(0).toUpperCase() + g.type.slice(1)) + ' <span class="chip">' + esc(g.status.replace("World", "")) + "</span></div></div>";
    });
    live += "</div>";
  } else live = empty("No games running", on.length ? "Players are in the menus. Create a lobby in the game to see it here." : "Nobody is online right now.");
  if (on.length) live += '<div class="pad"><span class="sub">Online: </span>' + on.map(function (n) { return '<span class="chip">' + esc(n) + "</span>"; }).join(" ") + "</div>";

  if (s.announcement) h += panel("Announcement", ["Server", "#server"], '<div class="pad"><pre>' + esc(s.announcement) + "</pre></div>");
  h += '<div class="grid2">' + panel("Lobbies", null, live) + panel("Ranked standings", ["Full table", "#leaderboards/ranked"], rankedTable(state.ranked, 5)) + "</div>";
  if (can("raceHistory")) h += panel("Latest races", ["All races", "#races"], matchTable((state.matches || []).slice(0, 6)));

  h += panel("Races per day", null, activityBody());
  var rec = "";
  (state.boards || []).forEach(function (t) {
    var top = t.top && t.top[0];
    rec += '<a class="track" href="#leaderboards/timeattack/' + esc(t.track) + '"><b>' + esc(t.trackName) + '</b><span class="time">' + esc(t.bestTimeText) + '</span><span class="sub">' +
      (top ? esc(top.accountName) : "") + " · " + t.players + (t.players === 1 ? " driver" : " drivers") + "</span></a>";
  });
  h += panel("Track records", ["Time Attack boards", "#leaderboards/timeattack"], rec ? '<div class="tracks">' + rec + "</div>" : empty("No Time Attack records yet", "Set a lap time in Time Attack to claim the first record."));
  return h;
}

/* Stacked bars: one bar per day (UTC) for the last 14 days, split by game mode. */
export function activityBody() {
  var s = state.summary;
  if (!s || !s.perDayByMode) return empty("Loading", "Fetching activity.");
  var DAYS = 14, now = Date.now(), days = [], byDay = {}, total = 0, modes = {};
  s.perDayByMode.forEach(function (r) {
    (byDay[r.day] = byDay[r.day] || []).push(r);
    total += r.races;
    modes[r.modeName] = (modes[r.modeName] || 0) + r.races;
  });
  for (var i = DAYS - 1; i >= 0; i--) {
    var d = new Date(now - i * 86400000), k = d.toISOString().slice(0, 10), parts = byDay[k] || [];
    days.push({ k: k, d: d, parts: parts, n: parts.reduce(function (a, r) { return a + r.races; }, 0), today: i === 0 });
  }
  if (!total) return empty("No races in the last 14 days", "Each finished race is counted here, split by game mode.");
  var max = Math.max.apply(null, days.map(function (x) { return x.n; }));
  var top = Math.max(2, max + (max % 2));               // an even axis maximum so the middle line is a whole number
  var busiest = days.reduce(function (a, x) { return x.n > a.n ? x : a; }, days[0]);
  var wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var cols = days.map(function (x) {
    var segs = x.parts.slice().sort(function (a, c) { return c.races - a.races; }).map(function (r) {
      return '<i class="m-' + modeKey(r.modeName) + '" style="height:' + (r.races / x.n * 100) + '%"></i>';
    }).join("");
    var tip = wd[x.d.getUTCDay()] + " " + x.k + ": " + x.n + (x.n === 1 ? " race" : " races") +
      x.parts.map(function (r) { return " · " + modeLabel(r.modeName) + " " + r.races; }).join("");
    return '<div class="col" title="' + esc(tip) + '"><div class="stack" style="height:' + (x.n / top * 100) + '%">' + segs + "</div></div>";
  }).join("");
  var xl = days.map(function (x) {
    return '<span class="' + (x.today ? "today" : "") + '">' + x.d.getUTCDate() + "<small>" + (x.today ? "today" : wd[x.d.getUTCDay()]) + "</small></span>";
  }).join("");
  var key = Object.keys(modes).sort(function (a, c) { return modes[c] - modes[a]; }).map(function (m) {
    return '<span><i class="m-' + modeKey(m) + '"></i>' + esc(modeLabel(m)) + " <b>" + modes[m] + "</b></span>";
  }).join("");
  return '<div class="act"><div class="act-head"><div><b>' + total + "</b><span>" + (total === 1 ? "race" : "races") + " in the last 14 days</span></div>" +
    "<div><b>" + days[DAYS - 1].n + "</b><span>today</span></div>" +
    "<div><b>" + busiest.n + "</b><span>on the busiest day (" + esc(wd[busiest.d.getUTCDay()] + " " + busiest.d.getUTCDate() + ".") + ")</span></div></div>" +
    '<div class="chart"><div class="yaxis" aria-hidden="true"><span style="top:0">' + top + '</span><span style="top:50%">' + (top / 2) + '</span><span style="top:100%">0</span></div>' +
    '<div class="plot" role="img" aria-label="Finished races per day over the last 14 days, split by game mode"><div class="cols">' + cols + "</div></div>" +
    '<div class="xlabels" aria-hidden="true">' + xl + "</div></div>" +
    '<div class="key">' + key + '</div><p class="sub" style="margin:0">Each bar is one day (UTC); its height is the number of finished races and the colours show the game mode. Hover a bar for the numbers.</p></div>';
}
