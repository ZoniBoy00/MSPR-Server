import { panel } from "../ui.js";
import { esc } from "../util.js";

var REPO = "https://github.com/ZoniBoy00/MSPR-Server";

/* what to try: [priority, what, how, what to look at] */
var CHECKS = [
  ["PS3", "Get online", "Start the game, go online, accept the EULA, open Wreckreation and the Leaderboards.", "No error dialogs. The announcement shows. The leaderboards load."],
  ["PS3", "A Ranked race", "Search for a Ranked game with one or more friends, race, and finish.", "Does your result, XP and rank show up straight after the race, or only later (for example after going back to the menus)? Note the times."],
  ["PS3", "Time Attack and ghosts", "Drive one clean lap on any track, then open the Time Attack leaderboard and download a ghost.", "Your time appears on the board. The ghost downloads without an error."],
  ["all", "Custom Game", "Create a Custom Game, let a friend find and join it, race.", "The game is listed, the join works, the race starts and ends."],
  ["all", "Casual", "Search for a Casual game with 2-4 players and race.", "The lobby fills, the race starts, everybody gets back to the lobby."],
  ["all", "Ranked with more players", "Ranked with 3-6 players, and if you can a full 12-player lobby.", "The countdown ends in a race, every driver gets a result, nobody is dropped."],
  ["all", "Speed Weekend", "Race a Speed Weekend event and look at the Weekend leaderboard.", "Your time is on the board. If a friend beats it, a red helmet appears and goes away once you have looked at the board."],
  ["all", "Mixed lobby", "Ranked or Casual with a PS3 and an RPCS3 player together.", "Both see each other, both finish, both get a result."]
];

function checks() {
  var h = '<div class="scroll"><table><thead><tr><th>Who</th><th>What</th><th>How</th><th>What to look at</th></tr></thead><tbody>';
  CHECKS.forEach(function (c) {
    h += "<tr><td>" + (c[0] === "PS3" ? '<span class="chip warn">PS3 first</span>' : '<span class="chip">everyone</span>') + "</td><td><b>" + esc(c[1]) + "</b></td><td>" + esc(c[2]) + "</td><td>" + esc(c[3]) + "</td></tr>";
  });
  return h + "</tbody></table></div>";
}

export function viewTesting() {
  var host = location.hostname;
  var h = '<div class="head"><div><h1>Testing guide</h1><p class="lede">This server is a temporary test server. Here is how to join, what is worth trying and how to report what you find.</p></div></div>';

  h += panel("Join the test", null, '<div class="pad">' +
    "<p><b>The server's address (DNS):</b> <code>" + esc(host) + "</code></p>" +
    "<p><b>Real PS3:</b> Settings, Network Settings, Internet Connection Settings, Custom. Set the DNS manually to the address above (primary DNS; leave everything else as it is). You need a PSN account.</p>" +
    "<p><b>RPCS3:</b> in the game's settings, Network, DNS address = the address above. You need an RPCN account and the US version (BCUS98155) with update 1.03. There is an optional patch for a Custom Game bug on the <a href=\"#server\">Server tab</a>.</p>" +
    '<p class="sub">To go back to the original service, set the DNS back to what it was.</p></div>');

  h += panel("What to try", null, '<div class="pad"><p>Real PS3 players are needed most: the server has only been tried briefly on a real console, and that is where problems have shown up so far. You do not have to do everything; one thing done and reported is a help.</p></div>' + checks());

  h += panel("Reporting what you find", null, '<div class="pad">' +
    "<p>The server writes down what happens, so what we need is <b>when</b> it happened and <b>who</b> you were. Please write down:</p>" +
    "<ul><li>the platform: real PS3 or RPCS3, and the game version;</li>" +
    "<li>what you played (Custom, Ranked, Casual, Time Attack, Speed Weekend) and how many players were in the game;</li>" +
    "<li>the <b>time with your time zone</b>, as exactly as you can (for example when the race ended);</li>" +
    "<li>your <b>player name</b> as it appears in the game;</li>" +
    "<li>what you expected and what happened instead: an error text, a dialog, a freeze, a result that did not show up (or showed up late).</li></ul>" +
    "<p>Then use one of the forms on GitHub (you need a free GitHub account):</p>" +
    '<p><a href="' + REPO + '/issues/new?template=ps3_test_report.yml" target="_blank" rel="noopener"><b>PS3 test report</b></a> for a real PS3, <b>also when everything worked</b> (a report without problems is just as useful).<br>' +
    '<a href="' + REPO + '/issues/new?template=bug_report.yml" target="_blank" rel="noopener"><b>Problem during play</b></a> for anything that went wrong, on any platform.</p>' +
    '<p>No GitHub account? Tell the same things to whoever gave you the link (for example on Discord). All issues: <a href="' + REPO + '/issues" target="_blank" rel="noopener">the issue list</a>.</p>' +
    '<p class="sub">Please do not post passwords, tokens or other people\'s personal details.</p></div>');

  h += panel("What the server records", null, '<div class="pad">' +
    "<p>Your player name, the games you join, your race results and stats are stored and shown on this site (the Drivers, Leaderboards and Races tabs). The server's log also holds the IP address you connect from and the technical details of your requests, which is how a problem report is matched to what happened. The logs are used to find faults. Passwords are never involved: the game logs in with the network ticket of your PSN or RPCN account.</p>" +
    '<p class="sub">Stats may be reset during testing, and the server may be down at times.</p></div>');

  h += panel("More", null, '<div class="pad"><p>The server and the research behind it are open source: <a href="' + REPO + '" target="_blank" rel="noopener">MSPR-Server</a> and <a href="https://github.com/ZoniBoy00/MSPR-RE" target="_blank" rel="noopener">MSPR-RE</a>. What the server logs and how to read it: <a href="' + REPO + '/blob/main/docs/guides/diagnostics.md" target="_blank" rel="noopener">the diagnostics guide</a>.</p></div>');
  return h;
}
