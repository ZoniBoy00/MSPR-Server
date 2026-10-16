import { state } from "../state.js";
import { matchTable, panel } from "../ui.js";
import { esc } from "../util.js";

export function viewRaces() {
  var modes = [["all", "All"], ["Ranked", "Ranked"], ["Casual", "Casual"], ["Online (custom)", "Custom"], ["Time Attack", "Time Attack"], ["Weekend", "Weekend"]];
  var h = '<div class="head"><div><h1>Races</h1><p class="lede">Every finished race, newest first. Each race has an id; open one to see its drivers, places and times.</p></div></div>';
  h += '<div class="tabs" role="group" aria-label="Mode">' + modes.map(function (m) {
    return '<button type="button" data-mode="' + esc(m[0]) + '" aria-pressed="' + (state.raceMode === m[0]) + '">' + esc(m[1]) + "</button>";
  }).join("") + "</div>";
  var rows = (state.matches || []).filter(function (r) { return state.raceMode === "all" || (state.raceMode === "Weekend" ? /Weekend/.test(r.modeName) : r.modeName === state.raceMode); });
  return h + panel(rows.length + (rows.length === 1 ? " race" : " races"), null, matchTable(rows));
}
