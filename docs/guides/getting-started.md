# Getting started: running the MSPR server on Windows

*The commands below run from the repository root (a clone of this repository) or from a packaged `dist\MSPR-Server`
folder built with `scripts\Build-Package.ps1`; both have the same layout. Running on a Linux server: see [deployment.md](deployment.md).*

A private server for MotorStorm: Pacific Rift (BCUS98155, update 1.03). It is played with RPCS3 and needs
an RPCN account. A real PS3 should work the same way with a PSN account, but that is untested (section 10).

## 1. Installation (once)

1. Get the files: clone the repository, or unzip a package, e.g. to `C:\MSPR-Server\`.
2. Run `scripts\INSTALL-MSPR.cmd`. It checks:
   * **.NET 10 runtime** (Horizon). If it is missing, `INSTALL-MSPR.cmd -AutoInstall` installs it with winget.
   * **Node.js 22.13+** (the TypeScript server). Installed the same way.
   * Horizon and the server dependencies (`npm ci`). A repository clone has no prebuilt Horizon: add `-Rebuild`
     (needs the .NET SDK) for the first run. A package already contains it.
3. Firewall: open PowerShell **as administrator**, go to the `scripts` folder and run
   `.\Install-MSPR.ps1 -Firewall`.

## 2. Starting and stopping

| File | What it does |
|---|---|
| `scripts\START-MSPR.cmd` | Starts everything, points RPCS3's MSPR config DNS to this PC and opens the MSPR Status window. |
| `scripts\START-MSPR.cmd -PublicIp auto` | The same, for friends over the internet (section 6). |
| `scripts\STOP-MSPR.cmd` | Stops everything and points RPCS3 back to the original service. |

More options: `-LogLevel quiet|normal|full`, `-NoDashboard`, `-KeepLogs N`,
`-RPCS3Config "<path>\config_BCUS98155.yml"` (if RPCS3's config is not found automatically).
You can also set it by hand: RPCS3 → the game's *Custom Configuration* → *Network* →
*DNS address* = the server PC's IP.

In the game, choose **Online**. Login, EULA, announcement, leaderboards, Custom Game and Ranked/Casual
matchmaking run on this server, and so do the Time Attack and Ranked leaderboards. Party invites go through RPCN (PSN on a PS3).

## 3. MSPR Status window

The window opens at start-up and refreshes every 2 seconds. It shows:

* the service ports (green = open, red = closed)
* **resources**: CPU, RAM and threads of Horizon, the TypeScript server and the status window, the server total and
  the whole computer's CPU and RAM
* players online and whose game each one is in
* running games (custom / ranked / casual) with player count and track
* the matchmaking queue
* the latest races with times (races rejected by the anti-cheat are marked ⚠)
* the latest warnings and errors from both logs

Closing the window does not stop the server. `STOP-MSPR.cmd` closes it too.
To open it by hand, run `npm run dashboard` in the `server` folder.

## 4. Status page and API

`http://<server IP>:8080/` is the status site: live lobbies and players, Ranked standings, Time Attack boards
per track and vehicle, every finished race with the finishing place, driver profiles, active bans and the
announcement. It has a light and a dark theme and works on a phone. The same data is available as JSON
(`/api/...`); the endpoints, their parameters and the time units are described in [api.md](../reference/api.md).

Game mode, track and vehicle are shown by name, read from the game's EBOOT (`server\src\svo\names.ts`).
Live game data comes from Horizon's endpoint `http://127.0.0.1:61920/GetMspr/`.

## 5. Settings: EULA, announcement and anti-cheat

The files are in `server\config\`. Text changes show immediately; `mspr.json` changes after a restart.

* **`eula.txt`**: the text of the game's terms window. One line in the file is one line on screen.
  Keep lines under about 90 characters and the whole text around 12 lines, like the original service.
* **`announcement.txt`**: the game's announcement/news text (one paragraph).
* **`mspr.json`** → `svo.eulaAlwaysShow` (default `true`): the EULA is shown every time a player goes
  online (the original service behaviour). `false` shows it only once per text version.
* **`mspr.json`** → `svo.host` (default `auto`): the address handed to the game as the SVO address. `auto`
  means the server's IP and no domain is needed. Do not change it to a name without a good reason: the
  game's SVO client has its own DNS resolver, and a single unanswered lookup jams it. The game then shows
  "An error occurred while communicating with the server" until it is restarted.
* **`mspr.json`** → `antiCheat` (section 8).

## 6. Playing with friends over the internet

1. Forward these ports on the router to the server PC:
   * TCP 10060, 10071, 10073, 10075, 10077, 10078, 10079 (and the status port, 8080 by default, if the site should be public)
   * UDP 53, **50000-50099** (the DME gives every player its own port; opening only 50000 lets just the first player in), 50100
   * The full list with the reason for each port is in [deployment](deployment.md#firewall-and-ports).
2. Start `START-MSPR.cmd -PublicIp auto` (or `-PublicIp <public IP>`).
3. Friends set the server's **public IP** as MSPR's *DNS address* in RPCS3.
4. When playing on the server PC itself, the router must support NAT loopback (hairpin). Most do.

Every address handed to the game is the public one: the MUIS universe, the SVO address, the lobby address
at login, the Ranked/Casual referral to MMS, the way back to the lobby and the race server (DME) address.
The original service's Ranked/Casual worked for its developer but not for other players because its MMS referral
pointed at a LAN address (192.168.2.103). This server always uses the advertised address.

## 7. Data and backups

* **`server\data\mspr.sqlite`**: accounts (the same account id for SVO and Medius), Medius stats
  (XP, rank, ranked statistics) and every race result. Back up this file.
* **`horizon\Servers\Horizon\bin\Release\net10.0\static\mspr_accounts.json`**: Horizon's backup copy of the accounts.

## 8. Anti-cheat (all of online)

Anti-cheat covers every game mode: Time Attack, Custom, Casual and Ranked.

**Race reports.** Every race report (`finishGame`) is checked before it can reach the leaderboards:

* the best lap time is a positive integer and not below `antiCheat.minLapTime`
  (default 2000 = 20 s; real laps take 40 s or more)
* the best lap's split times are positive and add up to the lap time (the game sends both, so an
  edited time is caught)
* track, vehicle and lap count are within the game's ranges
* an account reports at most `antiCheat.maxRacesPerMinute` races per minute (default 6)
* **online races (Custom, Ranked, Casual):** the player really was in a game of that type on the server
  within the last 30 minutes, and the placing fits that game's player count. The server samples
  Horizon's games every 5 seconds, so a faked "I won a Ranked race" report without a game is caught.
  If Horizon does not answer, this check is skipped (nobody is punished for a server problem).
* **wall clock (online races):** the race time cannot be longer than the time since the driver joined the game
  (the server saw the join). A driver first seen right after a server restart is not judged.
* **impossible numbers:** more time in first place than the whole race lasted.

A rejected race is stored with the reason (`races.flagged`) but never appears on any leaderboard. It is
marked ⚠ on the status page and in the status window, and `logs\server.log` gets an `[anticheat]` line.

**Findings to review.** Some things are only noticed, not rejected: the places of a race that disagree with its
times, a reported win with another place, an average speed above 432 km/h, an XP after a Ranked race that the game's
rules do not give, and Medius stats (race counters) that went backwards. They stay on the leaderboards and are listed on the status site's **Anti-cheat**
tab together with the rejected races and their reasons, because some of them rest on readings of the game's data that
are inferred. They never count towards an automatic ban.

**Bans.** A banned player cannot log in to online at all (Horizon asks the server at login), so no
online game mode is reachable. Their race reports are ignored too.

* **Automatic:** after `antiCheat.autoBanStrikes` rejected races within 24 hours (default 3) the
  account gets an `antiCheat.autoBanHours` hour ban (default 24, 0 = permanent).
  Only a report that is wrong on its own counts (an impossible lap time, splits that do not add up, values out of range).
  A race kept off the boards because it did not match a game Horizon saw, a result the game saved from before the login
  (`saved result:`) and the reports of an already banned account are not strikes ([diagnostics](diagnostics.md#saved-results-after-login)).
* **Manual:** `server\config\bans.txt`, one ban per line: `account Name` or `ip 1.2.3.4`, with an
  optional `# reason` shown to the player. The file is read on every login, no restart needed.
* **Removing:** delete the line. An automatic ban can be removed on this PC with
  `Invoke-RestMethod -Method Delete "http://127.0.0.1:8080/horizon/bans?kind=account&value=Name"`
  (`Name@PSN` for a PSN player).

Active bans are shown on the status page, in the status window and at `/api/bans`.

**Stats.** Medius stats (XP, rank) are validated (valid base64, at most 256 bytes) and the last 50
versions of every account are kept (`/horizon/accounts/<id>/stats-history` on this PC), so cheated
changes can be traced and restored.

Settings: `antiCheat` in `mspr.json` (`enabled`, `minLapTime`, `maxRacesPerMinute`, `autoBanStrikes`,
`autoBanHours`, `bansFile`).

**Limits:** the server does not see the driving itself: races run on the players' machines and DME only
relays their packets. In-race cheats (such as speed hacks) therefore cannot be detected by the server,
and a plausible time from a modified game passes. The stats blob's layout is known only in part (the XP is at
offset 8, see [ranked-xp](../research/ranked-xp.md)), so its values are checked only for race counters going backwards.

## 9. Logs

**Log level:** `START-MSPR.cmd -LogLevel quiet|normal|full` (default `normal`).

| Level | Horizon.log contains |
|---|---|
| `quiet` | connections, logins, MSPR matchmaking, warnings and errors |
| `normal` | the above plus every Medius request and response, but not the ECHO messages sent every 5 s or the Player/World reports sent every 30 s |
| `full` | every message (for debugging) |

**Log files:**
- `horizon\Servers\Horizon\bin\Release\net10.0\logs\Horizon.log` (Horizon)
- `logs\server.log` (DNS, SVO, web and anti-cheat)
- `server\data\svo_requests.log` (every SVO request)

On every start the previous run's logs are moved to an `archive` folder with a timestamp, for example
`Horizon-<date>_<time>.log`. The newest 20 are kept (`-KeepLogs N`).
Horizon writes a `[TickWatch]` warning when a step stalls the server for more than 1.5 seconds.

**Resources:** Horizon starts only the MotorStorm services (DME, the MUIS universe and port 10071).
Thread pools have `HORIZON_IO_THREADS` threads each (default 4). It uses about 150–250 MB of memory and
about 100 threads, down from about 900 MB and about 1800 threads.

## 10. Real PS3

The game runs the same code on a PS3 as in RPCS3. The only difference is the login:

* A PS3 signs in with a PSN account. Horizon checks the PSN ticket's signature (RPCS3's RPCN ticket is
  checked with RPCN's key).
* Setup: PS3 → Settings → Network Settings → Internet Connection Settings → Custom → manual DNS =
  the server's IP (the public IP over the internet).
* SVO and the leaderboards identify the player by the session cookie from the login, the same way on
  both platforms. On the original service, PS3 players' times did not reach the leaderboards. On this server the
  identification does not depend on the platform, but it has not been tested on a real PS3.

PSN and RPCN players are kept apart even when they have the same name. The server tells them apart by the
ticket's signer. In the database a PSN account's key is `name@PSN`; in the game and on the leaderboards
only the plain name is shown.

**Not tested:** a real PS3, and races with several real players. When you can test them, check the
status window's warnings and `Horizon.log` (`-LogLevel full` shows everything).

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "There was a problem connecting to the server (DNS error)" | RPCS3's DNS does not point to the server, or port 53 is taken / blocked by the firewall. |
| The game hangs while connecting | Check the status window's warnings and `Horizon.log`. `-LogLevel full` shows every message. |
| "There was a problem downloading your Location ID" | Horizon took over 10 seconds to answer the location query. This version fixes the known causes (MAS's slow settings initialisation and the PlayerReport timeout). If it happens again, look for a `[TickWatch]` line in `Horizon.log`: it names the slow step. |
| Login fails (ticket) | The RPCN account is not signed in in RPCS3. |
| "Port … is already in use" | `scripts\STOP-MSPR.cmd`, or close the other server (e.g. an old PSMultiServer). |
| The Ranked/Casual lobby does not start | Ranked needs at least 6 players and Casual 4 (the game's own rule). With fewer players the lobby's 30-second timer ends the game and the players return to the menu. |
| A race is missing from the leaderboard | Check on the status page whether it is marked ⚠ (anti-cheat), and the reason in `logs\server.log`. |

Self-test without the game: start the server in test mode (`scripts\Start-MSPRServer.ps1 -TestMode`)
and run `python -X utf8 tools\medius\e2e_check.py`. It goes DNS → MUIS → MAS → MLS → Ranked matchmaking
(MLS → MMS → back to the lobby) → stats to the database → SVO → race result on the leaderboard.

## 12. Testing Ranked/Casual alone

Ranked needs 6 players and Casual 4. Players are real participants in the game session, so the server
cannot invent them.

* **Experimental:** `scripts\Start-MSPRServer.ps1 -TestMinPlayers 2` advertises a minimum of
  2 players for matchmade games. It helps if the game reads the minimum from the game world.
* **Reliable:** run two or more RPCS3 instances on the same PC. Copy the RPCS3 folder, sign in to a
  second RPCN account in the copy and set the same DNS in both. Both choose Ranked or Casual.

## 13. RPCS3 patch: Custom Game map after Ranked/Casual

The game has a bug: after a successful Ranked or Casual search it writes the join data over the Custom
Game settings. After that the map cannot be changed in Custom Game and the map picture is missing.
The bug is in the game itself, so the server cannot fix it. The fix is the RPCS3 patch
`patches\rpcs3\imported_patch.yml` (address 0x2804e4, `li r5,0xdc` → `li r5,0xb0`).

The status site offers the file for download too (Server tab, "RPCS3 patch", or `/downloads/imported_patch.yml`).

1. Copy the file to RPCS3's `patches` folder. `START-MSPR` does this itself if the folder has no
   `imported_patch.yml` yet. If it has one, import the file with the Patch Manager's Import button.
2. RPCS3: right-click MotorStorm: Pacific Rift → **Manage Game Patches** → tick
   "Keep Custom Game settings after Ranked/Casual (MSPR server)" → Save.
3. Restart the game.

**Real PS3:** the bug is in the game's own code, so it also happens on a real PS3 (on the original service too).
A PS3 cannot use RPCS3 patches. The likely workaround (untested) is going back to the main menu or
restarting the game before Custom Game.

The patch is made for the US version 1.03 (BCUS98155). Other versions have a different EBOOT, so the
patch does not apply to them; the EU version would need its own patch.

## 14. EU version (BCES00129)

The server was built and tested with the US version (BCUS98155, update 1.03). The EU version should
reach the same server:

* MotorStorm: Pacific Rift uses the same Medius application (app id 21624) and the same server host in
  every region. The first MotorStorm had separate ids for NTSC/PAL/JPN; Pacific Rift does not.
* Horizon accepts a login by app id, not by disc region, so EU and US players share games and
  leaderboards.
* RPCS3: set the server IP in the EU game's own config (`config_BCES00129.yml`, Network → DNS).
  `START-MSPR` does this itself when it finds the file.
* Both versions need the same update (1.03) to be compatible.

**Untested:** the EU EBOOT has not been examined, so this is a conclusion, not a verified result. If an
EU game does not connect, check the login's app id in `Horizon.log`.

