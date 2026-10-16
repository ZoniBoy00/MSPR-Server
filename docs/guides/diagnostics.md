# Diagnostics: finding out what went wrong

Part of the players are on a real PS3, and a PS3 has no game log. So the server keeps its own record of what it saw. It is enough to answer the usual questions: who was in a game, who left when, who sent a result after the race and who did not, and was the game server reachable.

## Where to look

| What | Where | Contains |
|---|---|---|
| Event journal | status site, **Diagnostics** tab (admin only); `GET /api/diagnostics`; `server/data/diagnostics.log` (one JSON object per line) | games starting, ending, joins and leaves, a summary per game, logins, results, anti-cheat decisions, unknown requests, errors |
| SVO request log | `server/data/svo_requests.log` | every request of the game: time, address, request, account, then `-> status time in=bytes ua=User-Agent`. `ABORTED` means the game closed the connection before the answer was done. |
| Service journals | `journalctl -u mspr-server-ts`, `journalctl -u mspr-horizon` | the console output of both services, Horizon's Medius and DME messages |
| Status site | Live, Races, Anti-cheat tabs | the current state |

The event journal and the request log are written to disk, so they survive a restart. Each is kept at 10 MB plus one older copy.

## The game summary

When a Custom, Ranked or Casual game closes, the server writes `game.summary` about 20 seconds later. It lists every player who was in the game, the platform (a real PS3 comes through PSN, RPCS3 through RPCN), the seconds each one was in, and whether the player's race result arrived at the SVO service. For a game that lasted more than 90 seconds with more than one player, players without a result are named (`NO RESULT from ...`) and the event is a warning.

How to read it:

* **A result is missing for one player, the others sent theirs.** That player's game did not send it (the game decides that), or the player left before the results screen. The `game.leave` event shows when. If the same player is missing every time, look at that player's setup (version of the game, RPCS3 build, network).
* **Nobody sent a result.** Look at `svo.error`, `result without a login` and the request log for the same time.
* **`result ... without a login`.** The result arrived with no known session (the game logged in before a server restart or the cookie was lost). The result is not stored.
* **`horizon` error.** The game server did not answer the status poll. Check `systemctl status mspr-horizon`.
* **`svo.unknown`.** The game asked for something the server does not implement. The request is in the event.

The summary only counts a result as sent when it comes from the same mode as the game (Casual 6, Ranked 5, Custom 4) and arrives while the game was open or in the 20 seconds after it. Time Attack results that the game sends in the same moment (it posts older queued runs together with the race) are not counted as the race.

## Collecting everything for one incident

On the Linux server:

```
scripts/collect-diagnostics.sh 30
```

The argument is how many minutes back to look. The script prints the path of an archive in `/tmp` with the journals of both services, the event journal, the request log, the live game snapshot, the open ports and a 15 second count of the UDP packets per player on the race ports (needs `tcpdump`). Run it while a game is stuck: a player whose address sends almost no UDP packets is cut off or frozen. The archive has names and IP addresses but not the configuration file or the admin token.

## What the server cannot see

* Anything inside the race: the DME only relays the players' packets.
* What the game decided on the player's side, for example why it did not send a result. For an RPCS3 player the RPCS3 log (`log/RPCS3.log`, set the log level of the `HLE` and `NP` channels higher if needed) is the only source.
* The exact DME message a stuck game is waiting for. A packet capture of the race ports can show whether a player is sending at all.

## Every race report, and results that come late

Each `finishGame` request writes a `result.received` event before anything else is decided: who the player is and how the server recognised them (`session cookie`, `last login of the address` or `nobody`), the names of the cookies and the main request headers (`expect`, `transfer-encoding`, `content-length`, `connection`, ...), the size of the body and the time since the player's last SVO login. For a real PS3 whose result is late this shows whether the request comes at all, when, and what it looks like.

When a result arrives for a game whose summary already said `NO RESULT from ...`, a `game.summary.late` event says who, for which game and how many seconds after the game ended, and when nobody is missing a result any more. The summary itself is not rewritten.

## Recording a test session

For a first test with a real PS3 the logs are complete on the server's side: the DNS lookups the console forwards (`journalctl -u mspr-server-ts | grep forwarded` shows every PlayStation Network name with the time it took), the SVO request log (one line per request with status, time, sizes, cookie names and main headers) and the event journal. To see the bytes themselves, record the session with `scripts/capture-ps3.sh <ps3-ip>` as root (tcpdump of DNS, SVO, Medius and the race ports; the SVO traffic is plain HTTP, so the requests and answers can be read with Wireshark). The files stay on the server (they hold IP addresses), at most six of 100 MB. For a Medius message log add `HORIZON_VERBOSE=1` to the Horizon service for the test and remove it afterwards: it logs every message and is too much for daily use.

## Saved results after login

The game keeps the race results it could not send and posts them right after the next SVO login, often several at once. A real PS3 does this with races played before it came to this server. Such a result cannot be matched to a game the player is in now, so the anti-cheat used to reject it and count it as a strike, and three of them banned the player for 24 hours. Now a result that arrives within 30 seconds of the login:

* is not held to the per-minute limit (a backlog arrives as a burst),
* is kept off the boards, as before, when it does not fit a game on the server, but the reason starts with `saved result:` and it is **not a strike**,
* is recorded as `result.queued` in the event journal.

Impossible values (a lap time below the minimum and so on) are still rejected and still count.

## A lobby whose timer runs out and the race does not start

Seen once: a Ranked lobby with three players ran its countdown to 0 and nothing happened, then the players dropped out. The server had nothing odd in its logs; the only difference to a working game was the map (`Wildfire Volcanic`, add-on content) that some of the players did not own. The map is chosen by the host's game (the server creates the world with no track and the game fills it in), and the race can only start when every player has the map. The server cannot see who owns what. So when a lobby ends and nobody posted a result, the game summary now says so and names the map. Tracks 17-30 come from the game's second track table (the add-on maps and the Volcano variants); ask the players whether they all have them before looking for a server fault.

## Real PS3 players and the PlayStation Network

A real PS3 that uses this server's DNS asks it for much more than the game's own names: NP profiles (`getprof.*.np.community.playstation.net`, `static-resource.np.community.playstation.net`), authentication (`*.auth.np.ac.playstation.net`), the matching service (`*.np.matching.playstation.net`) and STUN (`*.np.stun.playstation.net`). RPCS3 emulates all of that itself and asks for none of it. The DNS used to answer these with a failure, and the PS3 retried them over and over (about 250 failed lookups per PS3 player in eight hours).

That is the most likely reason for two things seen only on a PS3: the result of a Casual or Ranked race arrives only when the game starts the next time, and the PlayStation Network steps of the game wait for failures instead of finishing (the game posts its NP scores first and its SVO scores after them). Now `dns.forwardNames` holds `playstation.net`, `playstation.com` and `sonyentertainmentnetwork.com` besides `np.rpcs3.net`, so a PS3 resolves Sony's own names as it would anywhere else. The game's own names (`motorstorm2ps3.online.scee.com` and the others in `localNames`) still point to this server and are answered first. The server forwards only these domains, never an arbitrary name.

If a PS3 player still sees a delay, compare the request log (`platform=PS3`) with the DNS lines in the service journal.

In an early test a real PS3 logged in, accepted the EULA and loaded the boards like RPCS3, but its Ranked results were saved only right after the next SVO login (`result.queued`). The firewall's DNS limiter had dropped no packet, so the delay is not the DNS rate limit. The next PS3 race should be read with the request log (does `finishGame` come at the end of the race or only at the next login?) and the `ticket` of its `login` event.

## The login event and the ticket check

Every SVO login writes a `login` event with the account, the platform (a real PS3 comes through PSN, RPCS3 through RPCN), `svoPlatform`, the address, the country and `ticket`: `{signer, valid, reason}`, the result of checking the NP ticket signature ([findings](../research/findings.md#4-the-np-ticket-and-its-signature-live-eboot)). `signer: rpcn, valid: true` is a normal RPCS3 login. `valid: false` is a warning (the ticket was altered, or the check is wrong for that kind of ticket); `valid: null` means the ticket could not be checked (version 4, truncated). Nothing is refused unless `svo.requireSignedTickets` is set.

`SVO-Platform: PS3` comes from RPCS3 as well, so it does not tell the two apart; the ticket signer and the `@PSN` suffix of the account do.

Other events: `weekend.beaten` (a player was told that somebody beat a Weekend time, with the times) and `svo.error` for refused oversized bodies and results with a malformed `gameMode`, `track` or `vehicle`.

## Reading a Weekend race in the logs

A won Speed Weekend race is one `finishGame` with mode 11, `won=1` and `timeRemaining`; a second report right after it (`position=100`, no `totalRaceTime`) only repeats the best time and is not listed as a race. `position=100` alone means the run was lost or abandoned. See [findings](../research/findings.md#2-speed-and-volcano-weekend-verified-live).

