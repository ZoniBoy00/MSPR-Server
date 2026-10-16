import { extras, refresh } from "./data.js";
import { loadMatch, renderModal } from "./modal.js";
import { TABS, can, hooks, state } from "./state.js";
import { empty, panel, restricted } from "./ui.js";
import { when } from "./util.js";
import { viewAnticheat } from "./views/anticheat.js";
import { viewDiagnostics } from "./views/diagnostics.js";
import { loadDrivers, viewDrivers } from "./views/drivers.js";
import { loadSpeed, loadTA, viewLeaderboards } from "./views/leaderboards.js";
import { viewLive } from "./views/live.js";
import { viewOverview } from "./views/overview.js";
import { loadProfile, viewPlayer } from "./views/player.js";
import { viewRaces } from "./views/races.js";
import { viewServer } from "./views/server.js";
import { viewTesting } from "./views/testing.js";
import { viewTracks } from "./views/tracks.js";

var view = document.getElementById("view");

/* ---------- render + data ---------- */
function render() {
  var f = { overview: viewOverview, live: viewLive, leaderboards: viewLeaderboards, drivers: viewDrivers, tracks: viewTracks, races: viewRaces, anticheat: viewAnticheat, diagnostics: viewDiagnostics, server: viewServer, testing: viewTesting, player: viewPlayer }[state.tab];
  var scrollY = window.scrollY;
  var tokenBox = document.getElementById("atoken"), typed = tokenBox ? tokenBox.value : null;   // a refresh must not wipe a token that is being typed
  var ae = document.activeElement, keep = ae && ae.id && view.contains(ae) ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;   // typing in the search box survives a refresh
  var gated = { anticheat: ["anticheat", "Anti-cheat", "The anti-cheat report"], races: ["raceHistory", "Races", "The race history"], diagnostics: ["diagnostics", "Diagnostics", "The server journal"], live: ["live", "Live", "Who is online"] }[state.tab];
  view.innerHTML = state.error && !state.status ? panel("Server unreachable", null, empty("Could not load data", state.error)) : gated && !can(gated[0]) ? restricted(gated[1], gated[2]) : f();
  if (typed !== null && document.getElementById("atoken")) document.getElementById("atoken").value = typed;
  if (keep) { var el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (x) { /* not a text field */ } } }
  window.scrollTo(0, scrollY);
  Array.prototype.forEach.call(document.querySelectorAll("#nav a"), function (a) {
    var need = { anticheat: "anticheat", races: "raceHistory", diagnostics: "diagnostics" }[a.getAttribute("data-tab")];
    a.hidden = !!need && !can(need);
    if (a.getAttribute("data-tab") === (state.tab === "player" ? "leaderboards" : state.tab)) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  var pill = document.getElementById("pill"), pt = document.getElementById("pill-text"), ok = state.status && !state.error;
  var horizon = ok && state.status.online && state.status.online.horizon === "ok";
  pill.className = "pill " + (horizon ? "live" : "off");
  pt.textContent = !ok ? "Offline" : horizon ? ((state.status.online.count != null ? state.status.online.count : (state.status.online.players || []).length) + " online") : "Game server down";
  document.getElementById("foot").textContent = state.loadedAt ? "Updated " + new Date(state.loadedAt).toLocaleTimeString() + (state.tab === "live" ? " · refreshes every 4 s" : " · refreshes every 10 s") : "";
}

function route() {
  var parts = (location.hash || "#overview").slice(1).split("/");
  if (parts[0] === "ranked") parts = ["leaderboards", "ranked"];                                   // older links
  else if (parts[0] === "timeattack") parts = ["leaderboards", "timeattack"].concat(parts.slice(1));
  state.tab = TABS.indexOf(parts[0]) >= 0 ? parts[0] : "overview";
  var raceId = state.tab === "races" && /^\d+$/.test(parts[1] || "") ? Number(parts[1]) : null;
  if (raceId !== state.matchId) { state.matchId = raceId; state.match = null; if (raceId !== null) loadMatch().then(renderModal); }
  if (state.tab === "leaderboards") {
    if (parts[1] === "ranked" || parts[1] === "timeattack" || parts[1] === "speed") state.lb = parts[1];
    if (state.lb === "speed" && parts[2]) { state.sp.track = parts[2]; state.sp.rows = null; loadSpeed().then(render); }
    if (state.lb === "timeattack" && parts[2]) { state.ta.track = parts[2]; state.ta.rows = null; loadTA().then(render); }
  }
  if (state.tab === "tracks") { state.trackId = parts[1] || null; state.trackDetail = null; }
  if (state.tab !== "tracks") state.trackId = null;
  Promise.all(extras()).then(render).catch(function () { /* the next refresh retries */ });
  if (state.tab === "player") { state.profileName = decodeURIComponent(parts[1] || ""); state.profile = null; loadProfile().then(render); }
  render();
  renderModal();
  if (state.matchId === null) window.scrollTo(0, 0);
}

view.addEventListener("click", function (e) {
  var row = e.target.closest("tr[data-race]");
  if (row && !e.target.closest("a, button")) { location.hash = "#races/" + row.getAttribute("data-race"); return; }
  var b = e.target.closest("button");
  if (!b) return;
  if (b.hasAttribute("data-admin-save") || b.hasAttribute("data-admin-clear")) {
    var box = document.getElementById("atoken");
    try { if (b.hasAttribute("data-admin-clear") || !box.value.trim()) localStorage.removeItem("mspr-admin"); else localStorage.setItem("mspr-admin", box.value.trim()); } catch (x) { /* storage blocked */ }
    state.access = null; state.bans = null; state.anticheat = null; state.diag = null; state.games = null; state.matches = null;
    refresh();
    return;
  }
  if (b.hasAttribute("data-strack")) { state.sp.track = b.getAttribute("data-strack"); state.sp.rows = null; render(); loadSpeed().then(render); }
  if (b.hasAttribute("data-track")) { state.ta.track = b.getAttribute("data-track"); state.ta.rows = null; render(); loadTA().then(render); }
  if (b.hasAttribute("data-lb")) { location.hash = "#leaderboards/" + b.getAttribute("data-lb"); }
  if (b.hasAttribute("data-mode")) { state.raceMode = b.getAttribute("data-mode"); render(); }
});

var driverTimer = null;

view.addEventListener("input", function (e) {
  if (e.target.id !== "dq") return;
  state.driversQ = e.target.value;
  clearTimeout(driverTimer);
  driverTimer = setTimeout(function () { loadDrivers().then(render); }, 250);
});

view.addEventListener("change", function (e) {
  if (e.target.id === "dsort") { state.driversSort = e.target.value; loadDrivers().then(render); }
  if (e.target.id === "sveh") { state.sp.vehicle = e.target.value; state.sp.rows = null; render(); loadSpeed().then(render); }
  if (e.target.id === "veh") { state.ta.vehicle = e.target.value; state.ta.rows = null; render(); loadTA().then(render); }
});

var raceDialog = document.getElementById("race-dialog");

raceDialog.addEventListener("click", function (e) { if (e.target === raceDialog || e.target.closest("[data-close]")) raceDialog.close(); });

raceDialog.addEventListener("close", function () {
  if (state.matchId !== null) { state.matchId = null; state.match = null; location.hash = "#races"; }
});

/* theme toggle: remembers the choice when storage is available */
var root = document.documentElement;
try { var saved = localStorage.getItem("mspr-theme"); if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved); } catch (e) { /* storage blocked */ }

document.getElementById("theme").addEventListener("click", function () {
  var dark = root.getAttribute("data-theme") ? root.getAttribute("data-theme") === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  var next = dark ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("mspr-theme", next); } catch (e) { /* storage blocked */ }
});

hooks.render = render;
hooks.renderModal = renderModal;

window.addEventListener("hashchange", route);

route();

refresh();

setInterval(function () {
  if (document.hidden) return;
  if (Date.now() - state.loadedAt >= (state.tab === "live" ? 3500 : 9500)) refresh();
}, 1000);
