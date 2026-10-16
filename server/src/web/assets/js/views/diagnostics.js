import { state } from "../state.js";
import { empty, panel } from "../ui.js";
import { esc, when } from "../util.js";

/* ---------- Diagnostics (admin only) ---------- */
function lvl(l) { return l === "error" ? '<span class="chip warn">error</span>' : l === "warn" ? '<span class="chip warn">warn</span>' : '<span class="chip">info</span>'; }

export function viewDiagnostics() {
  var d = state.diag;
  var h = '<div class="head"><div><h1>Diagnostics</h1><p class="lede">What the server saw: games, who joined and left, and who sent a result after a race. For finding out why a race did not count or a game got stuck, also for players on a real PS3 who have no game log.</p></div></div>';
  if (!d) return h + panel("Diagnostics", null, empty("Loading", "Fetching the journal."));
  var g = d.games.length ? '<div class="scroll"><table><thead><tr><th>Ended</th><th>Game</th><th>Type</th><th class="num">Time</th><th>Players (result sent?)</th></tr></thead><tbody>' + d.games.map(function (e) {
    var x = e.data || {};
    var ps = (x.players || []).map(function (p) {
      return '<span class="chip' + (x.race && !p.resultPosted ? ' warn' : '') + '" title="' + esc(p.platform + ", " + p.seconds + " s in the game") + '">' + esc(p.name.replace(/@RPCN$/, "")) + (p.platform.indexOf("PS3") === 0 ? " (PS3)" : "") + (x.race ? (p.resultPosted ? " ✓" : " ✗") : "") + "</span>";
    }).join(" ");
    return "<tr><td>" + when(e.t / 1000) + "</td><td>" + esc(x.name || "") + "</td><td>" + esc(x.type || "") + '</td><td class="num">' + Math.floor((x.seconds || 0) / 60) + ":" + String((x.seconds || 0) % 60).padStart(2, "0") + "</td><td>" + ps +
      (x.race && x.missing && x.missing.length ? ' <span class="sub">no result from ' + esc(x.missing.map(function (n) { return n.replace(/@RPCN$/, ""); }).join(", ")) + "</span>" : "") + "</td></tr>";
  }).join("") + "</tbody></table></div>" : empty("No games yet", "A summary appears about half a minute after a game closes.");
  h += panel("Games", null, g);
  var ev = d.events.length ? '<div class="scroll"><table><thead><tr><th>When</th><th>Kind</th><th></th><th>What</th></tr></thead><tbody>' + d.events.map(function (e) {
    return "<tr><td>" + when(e.t / 1000) + "</td><td>" + esc(e.kind) + "</td><td>" + lvl(e.level) + "</td><td>" + esc(e.msg) + "</td></tr>";
  }).join("") + "</tbody></table></div>" : empty("Nothing yet", "Events appear here as they happen.");
  h += panel("Latest events", null, ev);
  h += '<p class="sub">The same events are in <code>server/data/diagnostics.log</code> (one JSON object per line) and in the service journal. The SVO request log, <code>data/svo_requests.log</code>, has the status, time taken and User-Agent of every request.</p>';
  return h;
}
