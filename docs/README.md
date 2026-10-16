# Documentation

| Folder | For | Contents |
|---|---|---|
| [`guides/`](guides) | running the server | install and play, deploy on Linux, find out what went wrong |
| [`reference/`](reference) | understanding it | the JSON API, the architecture, the matchmaking, security |
| [`project/`](project) | following the project | status and open items, credits |
| [`research/`](research) | the reverse engineering behind it | protocol findings, the game's data |

## Guides

- [Getting started](guides/getting-started.md): install, start and stop on Windows, the status window, settings, internet play, anti-cheat, logs, troubleshooting.
- [Deployment](guides/deployment.md): a Linux server with systemd, firewall ports, building Horizon, settings.
- [Diagnostics](guides/diagnostics.md): the event journal, the request log and how to find out why a game or a race went wrong.

## Reference

- [API reference](reference/api.md): the status site and every JSON endpoint.
- [Architecture](reference/architecture.md): the two programs, the ports, the data flow of a race and where the data lives.
- [Ranked and Casual matchmaking](reference/ranked-casual.md): the matchmaking protocol as the game uses it and how the server implements it.
- [Security](reference/security.md): what is exposed, what is trusted, the limits and the known gaps.

## Project

- [Status](project/status.md): what works, what is untested, the open items.
- [Credits and sources](project/credits.md): the projects this server is derived from and the public information that helped.

## Research

Written while reverse engineering the game. The notes were true when they were written; where the server has since proved something different, the newer document says so.

- [Findings](research/findings.md): ghost download, Weekend verified, the NP ticket signature, first real PS3 observations, Horizon on .NET 10.
- [Reverse engineering report](research/reverse-engineering.md): protocol layers, matchmaking messages, SVO routes, identified functions.
- [Speed and Volcano Weekend](research/speed-weekend.md): what the game needs from a server.
- [Ghosts](research/ghosts.md): how the game uploads and downloads Time Attack ghosts.
- [Ranked XP and rank level](research/ranked-xp.md): how the game computes XP and what the `score` is.
- [Game data archive](research/game-data.md): what `ms2.psarc` holds, tracks, tickets, build options.
- [Announcements](research/announcements.md): format and the 1023-byte limit.
