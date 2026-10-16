# MSPR: a private server for MotorStorm: Pacific Rift

A community server for **MotorStorm: Pacific Rift** (US disc BCUS98155, update 1.03, Medius application 21624), played with RPCS3 and an RPCN account. A real PS3 has not been tested.

It replaces the game's online services: login and EULA, the lobby, Custom Game, Ranked and Casual matchmaking, race servers, and the Time Attack (with ghosts), Speed Weekend and Ranked leaderboards. It also comes with a status site and a JSON API.

| Works (tested with the real game in RPCS3) | |
|---|---|
| Online login (DNS, MUIS, MAS, MLS, RPCN ticket), EULA, announcement | ✅ |
| Custom Game: create a lobby, list it, join, play | ✅ |
| Ranked and Casual: search, race lobby, race, back to the lobby | ✅ |
| Time Attack (with ghosts), Speed Weekend and Ranked leaderboards | ✅ |
| Status site and [JSON API](docs/reference/api.md) | ✅ |
| Races with more than two real players, a real PS3 (login, EULA and boards work; results in time not yet confirmed) | untested |

Details and open items: [docs/project/status.md](docs/project/status.md).

## How it fits together

```text
 game (RPCS3) ──DNS──▶ server/   TypeScript: DNS, SVO (HTTP), status site + JSON API, SQLite, anti-cheat
      │                              ▲
      └──Medius / DME──▶ horizon/    C#: MUIS, MAS, MLS, MPS, MMS + DME race servers (Horizon)
                                     └── account and stats API ──▶ server/
```

More in [docs/reference/architecture.md](docs/reference/architecture.md).

## Quick start (Windows)

Needs the .NET 10 runtime, Node.js 22.13 or newer, and the .NET 10 SDK to build Horizon the first time.

```powershell
scripts\INSTALL-MSPR.cmd -Rebuild     # dependencies and Horizon
scripts\START-MSPR.cmd                # starts everything, points RPCS3's DNS to this PC
scripts\STOP-MSPR.cmd
```

The full guide, including playing over the internet, settings and anti-cheat, is [docs/guides/getting-started.md](docs/guides/getting-started.md). For a Linux server see [docs/guides/deployment.md](docs/guides/deployment.md).

## Repository layout

| Folder | Contents |
|---|---|
| `server/` | The TypeScript server (Node 22.13+). Tests: `cd server && npm ci && npm test`. |
| `horizon/` | Horizon (C#, .NET 10): Medius and DME. MSPR changes are in `Servers/Horizon/SERVER/Medius/Mspr/`. Derived from PSMultiServer, see [horizon/README.md](horizon/README.md). |
| `scripts/` | Windows scripts to install, start, stop and package the server. |
| `patches/` | The RPCS3 patch for a Custom Game bug in the game itself. |
| `tools/` | Python tools: Medius test client and end-to-end self-test, passive network capture, reverse engineering helpers. |
| `docs/` | Guides, API reference, architecture, status and research reports. |

## Documentation

- [Getting started](docs/guides/getting-started.md) · [Linux deployment](docs/guides/deployment.md) · [API reference](docs/reference/api.md)
- [Architecture](docs/reference/architecture.md) · [Ranked and Casual matchmaking](docs/reference/ranked-casual.md) · [Project status](docs/project/status.md) · [Security](docs/reference/security.md) · [Credits and sources](docs/project/credits.md)
- [Reverse engineering report](docs/research/reverse-engineering.md) · [All documents](docs/README.md)

## Related repository

[**MSPR-RE**](https://github.com/ZoniBoy00/MSPR-RE) holds the reverse engineering behind this server: the protocol reports, the redacted captures and the analysis tools. MSPR-Server is what was built from those findings.

## Built with AI assistance

Large parts of the code, the reverse engineering analysis and the documentation of this project (and of MSPR-RE) were written with [Claude](https://claude.com/claude-code) (Anthropic), working under the direction of the maintainer. The maintainer ran the game tests (RPCS3, and first tests on a real PS3) and decided what to build; the automated tests in `server/test` guard the behaviour. Mistakes can still be present, so please open an issue if you find one.

## Licence and third-party code

This repository is licensed under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)).

`horizon/` is derived from [PSMultiServer / PSHome MultiServer](https://github.com/GitHubProUser67/PSHome-MultiServer) (which in turn builds on the Horizon Medius emulator) and keeps its GPL-3.0 licence; the libraries inside it carry their own licences, see [NOTICE.md](NOTICE.md). The MSPR-specific code (`server/`, the MSPR parts of `horizon/`, `scripts/`, `tools/`, `patches/`, `docs/`) is released under the same licence so that the whole can be distributed together.

The repository contains no game files, no game code and no captures of other players: the Medius and SVO protocols were rebuilt from the behaviour of the game on the wire. You need your own copy of MotorStorm: Pacific Rift. MotorStorm is a trademark of Sony Interactive Entertainment; this project is not affiliated with or endorsed by Sony.
