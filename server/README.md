# server: SVO, DNS and status site (TypeScript)

The part of the MSPR server that is not Medius: DNS, the SVO HTTP service, the status site with its JSON API, the SQLite database and the anti-cheat. Medius and the race servers (DME) run in [Horizon](../horizon/README.md).

Needs Node.js 22.13 or newer (the built-in `node:sqlite`).

| Service | Port | What |
|---|---|---|
| DNS | 53 (UDP) | Answers the game's server names with this server's address and forwards the rest upstream. |
| SVO | 10060 | HTTP service compatible with the original service: URL list, NP-ticket login, EULA, announcement, leaderboards, race results. |
| Web | 8080 | Status site at `/`, JSON API under `/api` ([reference](../docs/reference/api.md)), and a loopback-only account API for Horizon under `/horizon`. |

```text
npm ci
npm start              # all services; `npm start -- svo web` starts only some
npm run dashboard      # MSPR Status console: resources, players, games, matchmaking, races, errors
npm test               # unit tests and a replay of the captured SVO traffic of the original service
npm run typecheck
```

## Source map

| File | Purpose |
|---|---|
| `src/index.ts` | Starts DNS, SVO and web. |
| `src/config.ts` | Loads `config/mspr.json`. |
| `src/svo/server.ts`, `protocol.ts` | SVO routes and wire format (XML, `X-SVOMac`, NP ticket reader). |
| `src/svo/anticheat.ts`, `src/online/integrity.ts` | Race report checks, bans, online race validation and the wall-clock check. |
| `src/svo/review.ts` | Findings that are noted for review but never reject a race (place vs time, speed, stats rollback). |
| `src/svo/names.ts` | Track, vehicle and game mode names read from the game's EBOOT. |
| `src/db/store.ts` | SQLite store: schema, accounts (shared with Horizon), Medius stats, bans. Its other methods delegate to the modules below. |
| `src/db/races.ts`, `matches.ts`, `anticheat.ts`, `people.ts` | Races and boards, the grouping of driver reports into races (cached), anti-cheat findings, drivers and tracks. |
| `src/web/server.ts`, `src/web/context.ts`, `src/web/privacy.ts` | HTTP server: rate limit, headers, routing, gzip, static files; access levels, the admin token and player-name aliases. |
| `src/web/routes/*.ts` | The endpoints, one file per area (system, boards, races, people, anticheat) and Horizon's private API. |
| `src/web/index.html`, `src/web/assets/` | The status site: HTML shell, `app.css` and the ES modules under `assets/js` (one per page). |
| `src/dns/server.ts` | DNS server. |
| `src/dashboard.ts`, `src/resources.ts` | The status console and its CPU/RAM sampler. |
| `test/` | Tests; `test/fixtures/svo/` holds the recorded requests and responses of the original service. |

## Configuration

Everything is in `config/`. Text files take effect immediately; `mspr.json` after a restart.

- `eula.txt`: the EULA shown in the game, one line on screen per line in the file. `svo.eulaAlwaysShow` (default `true`) shows it at every login like the original service; `false` shows it once per text version.
- `announcement.txt`: the in-game announcement.
- `bans.txt`: manual bans, one `account Name` or `ip 1.2.3.4` per line with an optional `# reason`.
- `mspr.json`: ports, DNS names, region, database path, leaderboard modes, `web.privacy` and `web.adminToken` (what the public status site shows, see [api](../docs/reference/api.md#privacy-and-access)) and the `antiCheat` settings (`enabled`, `minLapTime` in hundredths of a second, `maxRacesPerMinute`, `autoBanStrikes`, `autoBanHours`).

## Operation

- **Backups.** A consistent copy of the database is written to `data/backups/mspr-<date>.sqlite` at start-up (if today's is missing) and checked every six hours; the newest 14 are kept. Restore by stopping the server and copying a backup over `data/mspr.sqlite` (delete the `-wal` and `-shm` files first).
- **Shutdown.** On `SIGTERM` or `SIGINT` the database is checkpointed and closed, so a service restart leaves a single clean file.
- **Ghosts.** Time Attack ghosts posted with a result are kept in `data/ghosts/` (`<accountId>-<track>-<vehicle>.ghost` plus a `.json` with the lap time); a faster lap replaces the old one. They are not served to the game yet.
- **Request log.** `data/svo_requests.log` is rotated at 10 MB (one older copy, `.1`, is kept).
- **Web hardening.** The status site and API answer with `nosniff`, a strict content security policy and open CORS for the read-only `/api` data; one address may make 300 requests a minute (`429` after that; Horizon on loopback is exempt). Responses of the heavier endpoints are reused for three seconds.

## Data

The database is `data/mspr.sqlite` (tables `accounts`, `races`, `bans`, `stats_history`). Race rows keep the game's raw report (`raw`) so that results can be recalculated later; `flagged` holds the anti-cheat reason. PSN accounts (a real PS3) are stored as `name@PSN`, RPCN accounts by their plain name. Back up the file together with its `-wal` and `-shm` files, or stop the server first.
