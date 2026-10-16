import { state } from "../state.js";
import { empty, panel, who } from "../ui.js";
import { esc, get, plural, when } from "../util.js";

/* ---------- Drivers ---------- */
export function loadDrivers() {
  return get("/api/drivers?limit=500&sort=" + encodeURIComponent(state.driversSort) + "&q=" + encodeURIComponent(state.driversQ)).then(function (d) { state.drivers = d; });
}

export function viewDrivers() {
  var sorts = [["score", "Ranked score"], ["races", "Races"], ["recent", "Most recent"], ["name", "Name"]];
  var h = '<div class="head"><div><h1>Drivers</h1><p class="lede">Everyone who has logged in to the server. Open a driver for results, personal bests and the score chart.</p></div></div>';
  h += '<div class="controls"><label class="sub" for="dq">Search</label><input id="dq" type="search" placeholder="Driver name" autocomplete="off" value="' + esc(state.driversQ) + '">' +
    '<label class="sub" for="dsort">Sort by</label><select id="dsort">' + sorts.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === state.driversSort ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select></div>";
  var rows = state.drivers, body;
  if (!rows) body = empty("Loading", "Fetching the drivers.");
  else if (!rows.length) body = empty("No driver matches", state.driversQ ? "Try a shorter name." : "Nobody has logged in yet.");
  else {
    body = '<div class="scroll"><table><thead><tr><th>Driver</th><th class="num">Ranked #</th><th class="num">Score</th><th class="num">Wins</th><th class="num">Races</th><th>Last active</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      body += '<tr><td class="name">' + (r.online ? '<span class="dot-on" title="Online now"></span>' : "") + who(r.name) + '</td><td class="num">' + (r.rankedRank == null ? "-" : r.rankedRank) +
        '</td><td class="num time">' + (r.score || 0) + '</td><td class="num">' + r.wins + '</td><td class="num">' + r.races + "</td><td>" + (r.online ? '<span class="ok-note">online</span>' : when(r.active)) + "</td></tr>";
    });
    body += "</tbody></table></div>";
  }
  return h + panel(rows ? plural(rows.length, "driver", "drivers") : "Drivers", null, body);
}
