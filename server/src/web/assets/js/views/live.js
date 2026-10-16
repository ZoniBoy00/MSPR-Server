import { state } from "../state.js";
import { empty, modeChip, panel, trackLabel, who } from "../ui.js";
import { ago, esc, pad, when } from "../util.js";

/* ---------- Live ---------- */
export function viewLive() {
  var games = state.games || [], mm = state.mm || [], on = (state.status && state.status.online && state.status.online.players) || [];
  var h = '<div class="head"><div><h1>Live</h1><p class="lede">Games that are open right now, who is searching for a Ranked or Casual race, and who is online. Updates every few seconds.</p></div></div>';
  h += '<div class="stats"><div class="stat"><b>' + on.length + '</b><span>Online</span></div><div class="stat"><b>' + games.length + '</b><span>Open games</span></div><div class="stat"><b>' +
    mm.filter(function (x) { return (x.waiting || []).length; }).length + "</b><span>Searching</span></div></div>";
  var g = games.length ? '<div class="cards">' + games.map(function (x) {
    var names = (x.players || []).map(function (p) { return '<span class="chip">' + who(p.name.replace(/@RPCN$/, "")) + "</span>"; }).join(" ");
    var type = x.type.charAt(0).toUpperCase() + x.type.slice(1);
    return '<div class="card game"><div class="ghead"><h3>' + esc(x.name) + '</h3><div class="chips">' + modeChip(type === "Custom" ? "Online (custom)" : type) + '<span class="chip">' + esc(x.status.replace("World", "")) + "</span></div></div>" +
      '<div class="row2"><span>Host <b>' + who((x.host || "-").replace(/@RPCN$/, "")) + "</b></span><span>Track <b>" + esc(trackLabel(x.track)) + "</b></span><span>Opened <b>" + esc(ago(Date.parse(x.createdUtc) / 1000)) + "</b></span></div>" +
      '<div class="row2"><span>Players <b>' + x.playerCount + "</b> of " + x.minPlayers + "-" + x.maxPlayers + " (minimum to start - capacity)</span></div>" +
      "<div>" + (names || '<span class="sub">empty</span>') + "</div>" +
      '<details class="settings"><summary>Game settings</summary><code>' + esc((x.genericFields || []).join(" · ")) + '</code><div>The eight setting values the game sent when the lobby was created. Their meaning is not documented.</div></details></div>';
  }).join("") + "</div>" : empty("No open games", on.length ? "Players are in the menus. A Custom Game lobby appears here as soon as someone creates it." : "Nobody is online right now.");
  h += panel("Open games", null, g);
  var m = mm.length ? '<div class="cards">' + mm.map(function (x) {
    var wait = (x.waiting || []).map(function (n) { return '<span class="chip">' + who(n.replace(/@RPCN$/, "")) + "</span>"; }).join(" ");
    return '<div class="card"><div class="ghead"><h3>' + modeChip(x.type.charAt(0).toUpperCase() + x.type.slice(1)) + " search</h3>" + (x.failed ? '<span class="chip warn">failed</span>' : x.created ? '<span class="chip casual">world #' + x.worldId + "</span>" : '<span class="chip">creating</span>') + "</div>" +
      '<div class="row2"><span>Slots reserved <b>' + x.reserved + "</b> of 12</span><span>Parties <b>" + (x.parties || []).length + "</b></span><span>Opened <b>" + esc(ago(Date.parse(x.openedUtc) / 1000)) + "</b></span></div>" +
      "<div>" + (wait ? '<span class="sub">Waiting: </span>' + wait : '<span class="sub">Everyone has been placed in the game.</span>') + "</div></div>";
  }).join("") + "</div>" : empty("Nobody is searching", "Ranked and Casual searches show up here. A search stays listed for up to ten minutes.");
  h += panel("Matchmaking", null, m);
  h += panel("Online now", null, on.length ? '<div class="pad">' + on.map(function (n) { return '<span class="chip"><span class="dot-on"></span>' + who(n) + "</span>"; }).join(" ") + "</div>" : empty("Nobody online", "Players appear here as soon as they log in."));
  return h;
}
