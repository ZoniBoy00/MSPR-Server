import { can, state } from "../state.js";
import { empty, panel } from "../ui.js";
import { adminToken, esc, pad } from "../util.js";

export function viewServer() {
  var s = state.status || {}, bans = state.bans || [];
  var h = '<div class="head"><div><h1>Server</h1><p class="lede">Announcement shown in the game, active bans and the JSON endpoints behind this page.</p></div></div>';
  h += panel("Announcement", null, '<div class="pad"><pre>' + esc(s.announcement || "") + "</pre></div>");
  var b = bans.length ? '<div class="rows">' + bans.map(function (x) {
    return '<div class="row"><div class="grow"><div class="name">' + esc(x.value) + '</div><div class="sub">' + esc(x.reason || "banned") + "</div></div>" +
      (x.expires ? '<span class="sub">until ' + esc(new Date(x.expires * 1000).toLocaleString()) + "</span>" : '<span class="chip warn">permanent</span>') + "</div>";
  }).join("") + "</div>" : empty("No bans", "Automatic bans appear here. Manual bans are listed in server/config/bans.txt.");
  if (can("bans")) h += panel("Bans", null, b);
  var ac = state.access || {};
  if (ac.tokenLogin || ac.admin) {
    var note = ac.admin ? "You are viewing as the admin: restricted sections are shown." : "Public view" + (ac.pseudonymized ? "; player names are shown as aliases" : "") + ".";
    h += panel("Admin", null, '<div class="pad"><p class="sub">' + esc(note) + "</p>" +
      (ac.tokenLogin ? '<p><input id="atoken" type="password" autocomplete="off" placeholder="Admin token" value="' + esc(adminToken()) + '"> <button type="button" data-admin-save>Use token</button>' +
        (adminToken() ? ' <button type="button" data-admin-clear>Forget it</button>' : "") + "</p>" : "") + "</div>");
  }
  h += panel("RPCS3 patch", null, '<div class="pad"><p><b>Keep Custom Game settings after Ranked/Casual</b> (RPCS3 only, game version 1.03: BCUS98155 and BCES00129)</p>' +
    "<p>After a Ranked or Casual search the game copies the join data over the Custom Game settings, so the next Custom Game starts with track 0 and mode 5: the map cannot be changed and its picture is missing. " +
    "This patch makes the game copy only the fields needed to join (0xb0 bytes instead of 0xdc, one instruction at <code>0x2804e4</code>: <code>li r5,0xdc</code> to <code>li r5,0xb0</code>). It changes nothing else and sends nothing to the server.</p>" +
    '<p><a href="/downloads/imported_patch.yml" download>Download imported_patch.yml</a></p>' +
    "<ol><li>Copy the file to RPCS3's <code>patches</code> folder (if you already have an <code>imported_patch.yml</code> there, use the Import button of the Patch Manager instead).</li>" +
    "<li>Right-click MotorStorm: Pacific Rift, Manage Game Patches, tick &quot;Keep Custom Game settings after Ranked/Casual (MSPR server)&quot;, Save.</li><li>Restart the game.</li></ol>" +
    '<p class="sub">A real PS3 cannot use RPCS3 patches. The bug is in the game itself, so it also happens there.</p></div>');
  var eps = state.api || [];
  h += panel("JSON API", null, eps.length ? '<div class="endpoints list">' + eps.map(function (e) {
    return '<a href="' + esc(e.path.split("?")[0]) + '">' + esc(e.path) + "<small>" + esc(e.description) + "</small></a>";
  }).join("") + "</div>" : empty("Loading", "Fetching the endpoint list."));
  h += '<p class="sub">Game server link: ' + (s.online && s.online.horizon === "ok" ? "Horizon reachable" : '<span class="err">Horizon ' + esc((s.online && s.online.horizon) || "unknown") + "</span>") + "</p>";
  return h;
}
