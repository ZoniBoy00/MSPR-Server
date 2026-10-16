# Status site and JSON API


The TypeScript server (`server/`) serves a status site and a read-only JSON API on the web port (`web.port` in `server/config/mspr.json`, default 8080). The site at `/` is a single page that reads these endpoints; `GET /api` returns the list below as JSON, so the API describes itself.

All endpoints are `GET` and answer `application/json`. Most need no login; the parts that are restricted are listed in [Privacy and access](#privacy-and-access). Times in `bestTime` are the raw value the game sent: hundredths of a second for Time Attack and milliseconds for the online modes (Custom, Ranked, Casual) and for Speed / Volcano Weekend, where `bestTime` is the time left on the countdown. Every row that shows a time also carries `bestTimeText` (`m:ss.hh`), already converted correctly. Paged endpoints accept `limit` (default 50/100, max 500) and `offset`, and send the unpaged total in the `X-Total-Count` header.

| Endpoint | What it returns |
|---|---|
| `/api` | This endpoint list. |
| `/api/health` | `ok`, version, uptime, Node version, account and race counts, Horizon reachability, players and games live. Use it as a liveness probe. |
| `/api/status` | Counts, the latest races, the announcement text and who is online. |
| `/api/players` | Logged-in players and the game each one is in. |
| `/api/player?name=<driver>` | One driver: race counts per mode, Ranked position, score and wins, Time Attack personal bests, the total XP (Ranked score) after each scored race (`scoreHistory`: `score` = `total` = XP, `change` = difference to the race before), latest races, online state. `404` for an unknown driver. |
| `/api/games?type=custom\|ranked\|casual` | Live games with players, track, settings and status. |
| `/api/matchmaking` | Ranked and Casual buckets and the parties waiting for a world. |
| `/api/ranked?limit=&offset=` | Ranked standings. Per driver: `rank`, `races`, `wins`, `stats.score`, `stats.playersBeaten`. Sums over all clean Ranked races. |
| `/api/leaderboards` | Every Time Attack track with its record and the top 3. |
| `/api/leaderboard?track=&vehicle=&kind=&limit=&offset=` | One board (a `ranked` row also has `level` 1-50 and `rankTier` 1-5, derived from the XP with the game's own table). `kind` is `timeattack` (default), `speed` or `ranked`. `vehicle=0` means any vehicle. The `speed` board is for Speed and Volcano Weekend races and is ranked by `timeRemaining`, the time left on the countdown in milliseconds (more is better). |
| `/api/records` | The best Time Attack lap for every track and vehicle combination. |
| `/api/races?limit=&offset=&mode=&track=&vehicle=&player=` | Finished races, newest first. `place` is the finishing place among the human racers (1 = first). `mode` is the game mode id (4 custom, 5 ranked, 6 casual, 9 Time Attack). |
| `/api/matches?limit=&offset=&mode=&player=` | Races grouped by game: one entry per race with every driver, place and time, each with an id (`id`). The reports of the drivers of one online game (same mode, track and game id, within three minutes of the first) form one race. `X-Total-Count` holds the total. |
| `/api/match?id=` | One race in full: track, laps, and for every driver the place, vehicle, race time, time in first place, score, players beaten, wrecks, distance, boost and jump distances (kilometres, inferred from millimetres). `404` for an unknown id. |
| `/api/drivers?q=&sort=&limit=&offset=` | Every driver: race count, Ranked position, score and wins, last activity and whether the driver is online. `sort` is `score` (default), `races`, `recent` or `name`; `q` filters by name. |
| `/api/tracks` and `/api/track?id=` | Per track: races, drivers, modes, most used vehicles and the Time Attack record. The single-track form adds the record for every vehicle and the latest races. |
| `/api/anticheat?limit=` | Rejected races with their reasons, findings to review (they reject nothing) and the totals. |
| `/api/summary` | Races per mode, per day and per day split by mode (`perDayByMode`, last 14 days; days are UTC), busiest tracks, most active drivers. |
| `/api/meta` | Id-to-name tables for tracks, vehicles and game modes. |
| `/api/bans` | Active bans. IP bans are hidden. |
| `/downloads/imported_patch.yml` | Not JSON: the RPCS3 patch file, sent as a download (also linked on the Server tab). |
| `/api/diagnostics?limit=&kind=` | **Admin only.** The server's event journal: `games` (summaries of finished games, who sent a result) and `events` (newest first). See [diagnostics](../guides/diagnostics.md). |
| `/api/access` | What this viewer may see: `admin`, `anticheat`, `bans`, `live`, `raceHistory`, `diagnostics` (booleans), `pseudonymized` and `tokenLogin`. The status site reads it to hide what it may not show. |

## Privacy and access

By default everything above is public except the anti-cheat report. A section is either `public` or `admin`, set under `web.privacy` in `server/config/mspr.json`:

| Setting | Default | What it covers when it is `admin` |
|---|---|---|
| `anticheat` | `admin` | `/api/anticheat` (rejected races, findings, who was flagged) and the Anti-cheat tab. |
| `bans` | `public` | `/api/bans` and the Bans panel. |
| `live` | `public` | Who is online: `/api/players`, `/api/games`, `/api/matchmaking`, the names under `online` in `/api/status`, and the online state in `/api/drivers` and `/api/player`. `online.count` still tells how many are logged in. |
| `raceHistory` | `public` | Single races with every driver's result: `/api/races`, `/api/matches`, `/api/match`, `recent` in `/api/status`, `/api/track` and `/api/player`, and the Races tab. |
| `pseudonymize` | `false` | `true` shows every player name as a stable alias (`Driver-3fa91c`) to viewers who are not admins. `salt` makes the aliases unguessable; leave it empty and they change at every restart. A driver is then looked up by the alias (`/api/player?name=Driver-3fa91c`), the real name is not found. |

Leaderboards, records, tracks and the Ranked table stay available in every mode, so the site keeps working with all restrictions on.

A restricted endpoint answers `403` with `{"error":"restricted","section":"..."}` to a viewer who is not an admin. **Who is an admin:**

* a request that comes from the server's own machine (loopback) and has no `X-Forwarded-For` header, and
* a request that carries the token set as `web.adminToken` (or the environment variable `MSPR_ADMIN_TOKEN`), as `Authorization: Bearer <token>` or `X-Admin-Token: <token>`. The status site has a field for it on the Server tab and keeps it in the browser. There is no token by default, so a remote viewer can never be an admin until you set one. Use a long random value and serve the site over HTTPS (a reverse proxy) if the token crosses the internet, because plain HTTP shows it to everybody on the way.

Behind a reverse proxy that sets `X-Forwarded-For`, no request counts as local, so the proxy's own machine is not an admin by accident. `/horizon/*` (Horizon's accounts, stats and ban interface) follows the same rule and answers only a direct connection on loopback; the admin token does not open it. Every mutating call lives there, and the public API has no route that changes anything.

The data is not hidden from someone who plays on the server: names, times and results that the game itself shows to other players in its leaderboards stay public in the Ranked and Time Attack boards.

## Limits and CORS

Responses larger than 1 kB are gzip-compressed when the client sends `Accept-Encoding: gzip`.

Every `/api` answer carries `Access-Control-Allow-Origin: *`, so pages on other sites can read it. One address may make 300 requests a minute; beyond that the server answers `429` with a `Retry-After` header. `/api/ranked`, `/api/summary`, `/api/records` and the leaderboard lists are cached for three seconds.

## Notes

- **Finishing place.** The game's `position` field is not the place (both racers of a two-player race report 2). The server derives the place from the `placedN` flag, then from `playersBeatenBy`, and only then from `position`. Against the clock (Time Attack, Speed and Volcano Weekend) `place` is `null`, except that a won Weekend run (`won=1`) is 1; `position` 100 (a run that was not finished) gives `null` in every mode.
- **Weekend bookkeeping reports.** After a Weekend race the game posts a second report with only the best time; it is stored but left out of `/api/races`, `/api/matches`, the counts and the summaries.
- **Ranked board.** The game asks `GET /motorstormpr/leaderboard/ranked?...&stat.score=1&stat.playersBeaten=1`. The server answers with `score` as the driver's latest total XP (the game reports its own running total) and the other stats summed, under the same attribute names. This is separate from the JSON API above.
- **Anti-cheat.** Races the anti-cheat rejects stay out of every board and standing but appear in `/api/races` with a `flagged` reason.
- **Internal endpoints.** `/horizon/*` is Horizon's private interface and only answers on the loopback address.
