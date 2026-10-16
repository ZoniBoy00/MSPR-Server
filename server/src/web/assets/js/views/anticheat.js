import { state } from "../state.js";
import { empty, modeChip, panel, raceLink, who } from "../ui.js";
import { esc, km, pad, when } from "../util.js";

export var KIND = { "speed": "Speed", "place-vs-time": "Place vs time", "won-mismatch": "Win mismatch", "two-winners": "Two winners", "stats-rollback": "Stats went back" };

/* ---------- Anti-cheat ---------- */
export function viewAnticheat() {
  var a = state.anticheat;
  var h = '<div class="head"><div><h1>Anti-cheat</h1><p class="lede">What the server checks, what it rejected and what it only noticed. The race itself runs on the players\' machines, so the server judges what the games report.</p></div></div>';
  if (!a) return h + panel("Anti-cheat", null, empty("Loading", "Fetching the anti-cheat report."));
  h += '<div class="stats"><div class="stat"><b>' + a.counts.racesChecked + "</b><span>Driver reports checked (" + a.counts.matches + " races)</span></div><div class=\"stat\"><b>" + a.counts.rejectedTotal + "</b><span>Rejected (" + a.counts.rejectedWeek + " this week)</span></div>" +
    '<div class="stat"><b>' + a.counts.findingsTotal + "</b><span>To review (" + a.counts.findingsWeek + " this week)</span></div><div class=\"stat\"><b>" + (state.bans || []).length + "</b><span>Active bans</span></div></div>";
  h += '<div class="grid2">' + panel("Rejected: kept off every leaderboard", null,
    '<div class="pad"><ul class="kvlist"><li><b>Lap time</b> below the minimum, split times that do not add up, values outside the game\'s ranges, too many reports a minute.</li>' +
    "<li><b>Not in a game</b>: an online race reported by a driver who was in no such game on the server, or a place beyond the number of players.</li>" +
    "<li><b>Wall clock</b>: a race time longer than the time since the driver joined the game.</li>" +
    "<li><b>Impossible numbers</b>: more time in first place than the race lasted.</li></ul>" +
    '<p class="sub" style="margin:10px 0 0">' + (a.autoBanStrikes ? a.autoBanStrikes + " rejected races within 24 hours ban the driver for " + (a.autoBanHours ? a.autoBanHours + " hours" : "good") + "." : "Automatic bans are off.") + "</p></div>") +
    panel("To review: noticed, not rejected", null,
    '<div class="pad"><ul class="kvlist"><li><b>Place vs time</b>: a driver ahead of another with the slower race time.</li><li><b>Win mismatch / two winners</b>: reports that contradict each other.</li>' +
    "<li><b>Speed</b>: an average speed above 432 km/h (distance divided by time).</li><li><b>Stats went back</b>: race counters in the stats blob decreased (the XP is not checked here: it falls after a loss).</li><li><b>XP mismatch</b>: the XP a driver reports after a Ranked race does not follow from the earlier XP, the finishing order and the other drivers' levels (the game's own rules).</li></ul>" +
    '<p class="sub" style="margin:10px 0 0">These stay on the leaderboards. Some rest on readings of the game\'s data that are not documented, so they are for a human to judge.</p></div>') + "</div>";
  var rej = a.rejected.length ? '<div class="scroll"><table><thead><tr><th>When</th><th>Driver</th><th>Mode</th><th>Track</th><th>Reason</th><th>Race</th></tr></thead><tbody>' + a.rejected.map(function (r) {
    return "<tr><td>" + when(r.t) + '</td><td class="name">' + who(r.name) + "</td><td>" + modeChip(r.modeName) + "</td><td>" + esc(r.trackName) + '</td><td style="white-space:normal;min-width:260px">' + esc(r.reason) + "</td><td>" + raceLink(r.matchId) + "</td></tr>";
  }).join("") + "</tbody></table></div>" : '<div class="empty"><b class="ok-note">Nothing rejected</b>Every report so far passed the checks.</div>';
  h += panel("Rejected races", null, rej);
  var fin = a.findings.length ? '<div class="scroll"><table><thead><tr><th>When</th><th>Driver</th><th>Finding</th><th>Detail</th><th>Race</th></tr></thead><tbody>' + a.findings.map(function (f) {
    return "<tr><td>" + when(f.t) + '</td><td class="name">' + who(f.name) + '</td><td><span class="chip warn">' + esc(KIND[f.kind] || f.kind) + '</span></td><td style="white-space:normal;min-width:260px">' + esc(f.detail) + "</td><td>" + raceLink(f.matchId) + "</td></tr>";
  }).join("") + "</tbody></table></div>" : '<div class="empty"><b class="ok-note">Nothing to review</b>No report has looked odd so far.</div>';
  h += panel("Findings to review", null, fin);
  return h;
}
