# Architecture

The server is two programs that share one account database.

| Program | Folder | Language | Does |
|---|---|---|---|
| **Horizon** | [`horizon/`](../../horizon) | C# (.NET 10) | The Medius servers and the DME race servers. Everything that speaks the game's binary protocol (SCE-RT over TCP and UDP). |
| **server** | [`server/`](../../server) | TypeScript (Node 22.13+) | DNS, the SVO HTTP service, the status site and JSON API, the SQLite database and the anti-cheat. |

Medius is the online platform the game was built on. Horizon is an open-source implementation of it; the MSPR-specific parts (Ranked and Casual matchmaking, game list rules, location name, account storage) were added on top.

## Ports

| Service | Port | Program |
|---|---|---|
| DNS | UDP 53 | server |
| SVO (HTTP) | TCP 10060 | server |
| Status site and API | TCP 8080 (live server: 8081) | server |
| MUIS (universe information) | TCP 10071 | Horizon |
| MAS (authentication) | TCP 10075 | Horizon |
| MLS (lobby) | TCP 10078 | Horizon |
| MMS (matchmaking) | TCP 10079 | Horizon |
| MPS (the game connects to it) | TCP 10077 | Horizon |
| DME (race server) | TCP 10073, UDP 50000 and up, one UDP port per player | Horizon |
| Horizon's own HTTP endpoints | TCP 10076, 61920, 8443, 3001 | Horizon, local use only (keep closed in the firewall) |

## What happens when a player goes online

1. **DNS.** The game resolves its original server name (`motorstorm2ps3.online.scee.com`). The DNS service answers with this server's address, so the game contacts it instead of the closed original service. RPCS3's *DNS address* setting points at the server.
2. **MUIS.** The game asks the universe server where authentication, lobby and SVO are. Horizon answers with this server's addresses, including the SVO address as an IP so that the game's own resolver is not needed.
3. **MAS.** The game logs in with its NP ticket. Horizon checks the ticket, asks the TypeScript server for the account (creating it on first login) and checks for bans.
4. **SVO.** In parallel the game logs in to SVO with the same ticket, accepts the EULA and reads the announcement. SVO identifies the player by a session cookie.
5. **MLS.** The player joins the lobby. From here the menus work: the game list for Custom Game, the matchmaking for Ranked and Casual.
6. **A race.** Horizon creates a game world on a DME. The players connect to the DME over TCP and a UDP port of their own; the DME relays the game's packets between them. The server never sees the driving, only the relayed packets.
7. **Results.** Each client posts its result to SVO (`finishGame`). The anti-cheat checks it, the race is stored in SQLite, and the leaderboards, Ranked standings, the status site and the API read from there.

[Ranked and Casual matchmaking](ranked-casual.md) describes the matchmaking messages in detail.

## Data

One SQLite database, `server/data/mspr.sqlite`, belongs to the TypeScript server:

| Table | Holds |
|---|---|
| `accounts` | One row per player, shared by SVO and Medius (the same account id on both sides), the Medius stats blob (XP, rank). |
| `races` | Every race report, including the raw report, the anti-cheat verdict and the derived finishing place. |
| `bans` | Manual and automatic bans. |
| `stats_history` | The last versions of each account's stats blob, for tracing cheated changes. |
| `anticheat_events` | Findings of the anti-cheat to review (they reject nothing). |
| `weekend_views` | When a player last looked at a Speed/Volcano Weekend board (clears the "somebody beat your time" marker). |

What in `horizon/` is specific to the game and what was changed for operation is listed in [horizon/MSPR-CHANGES.md](../../horizon/MSPR-CHANGES.md).

Horizon keeps a backup copy of the accounts in `static/mspr_accounts.json` and reaches the database through the loopback-only `/horizon/*` API of the TypeScript server.

## Design choices worth knowing

- **Times have two units.** Time Attack reports hundredths of a second, the online modes report milliseconds. Online races are therefore kept off the Time Attack boards, and times are converted for display. See [api.md](api.md).
- **Finishing place.** The game's `position` field counts the whole field, so the place is derived from `placedN` and `playersBeatenBy`. Against the clock there is none: Time Attack has no place, a Speed/Volcano Weekend run is 1st when `won=1`, and `position=100` means the run was not finished.
- **Game-facing routes of SVO** (port 10060): `index`, `ticket/login`, `getRegion`, `getEula`, `acceptEula`, `getAnnouncement`, `leaderboard/timeattack|speed|ranked`, `leaderboard/ghost`, `finishGame`, `speed-weekend/beaten|viewed`. Protocol details: [research/reverse-engineering.md](../research/reverse-engineering.md).
- **Security.** What is exposed, what is trusted and the limits: [security](security.md).
- **Ranked leaderboard.** The game asks SVO for it with the stats it wants (`stat.score`, `stat.playersBeaten`); the server answers with the sums over each player's clean races.
- **One UDP port per player.** The DME hands every player its own UDP port starting at 50000. A firewall that opens one port lets only the first player into a race.
- **Restarting Horizon drops every player.** Do it when nobody is in a game.
- **One stuck tick stops everything.** All Medius servers run in one tick loop; a loop that never ends in one of them (the empty channel group in `MMS.Tick` on .NET 8+) silences every answer. Enumerate `Group.ToArray()`, never the group itself.
