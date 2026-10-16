import { state } from "../state.js";
import { empty, matchTable, panel, trackLabel, who } from "../ui.js";
import { ago, esc, pad, plural } from "../util.js";

/* ---------- Tracks ---------- */
export function loadTrack() {
  var id = state.trackId;
  return fetch("/api/track?id=" + encodeURIComponent(id), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : false; }).catch(function () { return false; })
    .then(function (d) { if (state.trackId === id) state.trackDetail = d; });
}

export function viewTracks() {
  if (state.trackId) return viewTrack();
  var h = '<div class="head"><div><h1>Tracks</h1><p class="lede">Every track that has been raced: how often, by how many drivers, in which vehicles, and the Time Attack record.</p></div></div>';
  var ts = state.tracks;
  if (!ts) return h + panel("Tracks", null, empty("Loading", "Fetching the tracks."));
  if (!ts.length) return h + panel("Tracks", null, empty("No races yet", "A track is listed after its first finished race."));
  return h + panel(plural(ts.length, "track", "tracks"), null, '<div class="cards">' + ts.map(function (t) {
    var top = t.vehicles.slice(0, 3).map(function (v) { return '<span class="chip">' + esc(v.vehicleName) + " " + v.races + "</span>"; }).join(" ");
    return '<a class="card" href="#tracks/' + esc(t.track) + '"><h3>' + esc(t.trackName) + '</h3><div class="row2"><span><b>' + t.races + "</b> races</span><span><b>" + t.drivers + "</b> " + (t.drivers === 1 ? "driver" : "drivers") + "</span><span>" + esc(ago(t.lastRace)) + "</span></div>" +
      '<div>' + (t.record ? '<span class="time">' + esc(t.record.bestTimeText) + '</span> <span class="sub">' + esc(t.record.accountName) + " · " + esc(t.record.vehicleName) + "</span>" : '<span class="sub">No Time Attack record yet</span>') + "</div><div>" + top + "</div></a>";
  }).join("") + "</div>");
}

export function viewTrack() {
  var t = state.trackDetail;
  var back = '<p class="lede"><a href="#tracks">All tracks</a></p>';
  if (t === false) return '<div class="head"><div><h1>Track not found</h1>' + back + "</div></div>" + panel("Track", null, empty("No races on this track yet", "A track is listed after its first finished race."));
  if (!t) return '<div class="head"><div><h1>' + esc(trackLabel(state.trackId)) + "</h1>" + back + "</div></div>" + panel("Track", null, empty("Loading", "Fetching the track."));
  var h = '<div class="head"><div><h1>' + esc(t.trackName) + "</h1>" + back + "</div></div>";
  h += '<div class="stats"><div class="stat"><b>' + t.races + "</b><span>Races</span></div><div class=\"stat\"><b>" + t.drivers + "</b><span>Drivers</span></div>" +
    (t.record ? '<div class="stat"><b class="time" style="font-size:28px">' + esc(t.record.bestTimeText) + "</b><span>Record</span></div>" : "") + "</div>";
  var maxV = Math.max.apply(null, t.vehicles.map(function (v) { return v.races; }).concat([1])), maxM = Math.max.apply(null, t.modes.map(function (v) { return v.races; }).concat([1]));
  var bars = function (list, max, label) { return '<div class="pad">' + list.map(function (v) { return '<div class="hbar"><span>' + esc(label(v)) + '</span><span class="hb"><i style="width:' + Math.round(v.races / max * 100) + '%"></i></span><span>' + v.races + "</span></div>"; }).join("") + "</div>"; };
  h += '<div class="grid2">' + panel("Vehicles used", null, bars(t.vehicles, maxV, function (v) { return v.vehicleName; })) +
    panel("Game modes", null, bars(t.modes, maxM, function (v) { return v.modeName === "Online (custom)" ? "Custom Game" : v.modeName; })) + "</div>";
  var rec = t.records.length ? '<div class="scroll"><table><thead><tr><th>Vehicle</th><th>Driver</th><th class="num">Best time</th></tr></thead><tbody>' + t.records.map(function (r) {
    return "<tr><td>" + esc(r.vehicleName) + '</td><td class="name">' + who(r.accountName) + '</td><td class="num time">' + esc(r.bestTimeText) + "</td></tr>";
  }).join("") + "</tbody></table></div>" : empty("No Time Attack times", "Records per vehicle appear after a Time Attack run on this track.");
  h += panel("Time Attack records by vehicle", ["Leaderboard", "#leaderboards/timeattack/" + esc(t.track)], rec);
  h += panel("Latest races on this track", ["All races", "#races"], matchTable(t.recent));
  return h;
}
