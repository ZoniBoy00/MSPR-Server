# Project status

## Working (tested with the real game in RPCS3)

| Feature | Status |
|---|---|
| Online login (DNS → MUIS → MAS → MLS, RPCN ticket) | ✅ |
| SVO: EULA (on every login), announcement, region | ✅ |
| Custom Game: create, change map and laps, list the lobby for other players, race with two players | ✅ |
| Ranked and Casual: search → MLS referral to MMS → JoinAssignedGame → race lobby; Ranked race with two players, results of both drivers | ✅ |
| Time Attack: times, leaderboards, ghost upload and **ghost download** (the game asks `leaderboard/ghost`; the ghost shows in Time Attack) | ✅ |
| In-game Ranked leaderboard (score = latest total XP, players beaten summed, from `finishGame`) | ✅ |
| **Speed Weekend**: result, Weekend leaderboard (most time left first), "somebody beat your time" marker (`speed-weekend/beaten`, red → green after `viewed`) | ✅ (Volcano Weekend, mode 10, not seen yet) |
| Status site (live lobbies, leaderboards, drivers, tracks, races, anti-cheat report), [JSON API](../reference/api.md); race lists show no place against the clock, a Weekend win is 1st and position 100 is "did not finish" | ✅ |
| RPCS3 patch for the Custom Game map bug can be downloaded from the status site (Server tab) | ✅ |
| Custom Game map after Ranked (game bug) | ✅ with the RPCS3 patch |
| Diagnostics: event journal, SVO request log, Diagnostics tab, `scripts/collect-diagnostics.sh` ([diagnostics](../guides/diagnostics.md)) | ✅ |
| Privacy controls (`web.privacy`, `web.adminToken`) | ✅ |
| Horizon on **.NET 10** (Linux server) | ✅ |
| Security hardening of the public ports ([security](../reference/security.md)) | ✅ |
| NP ticket signature check at the SVO login | 🟡 logs only; RPCN tickets verify (6 of 6), the PSN path is not yet seen on a real ticket |
| Anti-cheat: wall-clock and cross-report checks, findings to review, bans | ✅ code, **off on the live server** (it banned real PS3 players by mistake) |
| Real PS3 players | 🟡 login, EULA and leaderboards work; Ranked results arrived only at the next SVO login; PSN names are forwarded by the DNS since then; to be confirmed with a PS3 player |

## Untested

* **A real PS3** (PSN tickets, results in time, `ticket.valid` of a PSN login).
* Races with more than two real players (Ranked 6, Casual 4 players, a 12-player lobby); a full Casual race with two players.
* The XP of Ranked races with more than two drivers ([ranked-xp](../research/ranked-xp.md)).
* Volcano Weekend (mode 10). The notice for a beaten time is the game's own text ("Your Best Time has been beaten -"); the vehicle numbering of the `beaten` answer is the same 1-based class number as everywhere else ([game data](../research/game-data.md)).
* An internet server with players outside the host's own PC beyond the test group; the EU version (BCES00129).
* Long-term stability of Horizon on .NET 10 (newly in use).

## Open items

What is still to test or to find out. The most useful next test is a real PS3 player.

### Test
- **A real PS3** (so far RPCS3 only): login, a whole race, results in time. Read `ticket.valid` (signer `psn`), `result.queued` and the game summary in the Diagnostics tab; then decide on `svo.requireSignedTickets`.
- Real 6-player Ranked race (the Ranked board needs 6 players; checks the anti-cheat and the XP on real data), a 4-player Casual race, a lobby of 10-12 players.
- A full Casual race with two players.
- Cancel test: a player cancels a Ranked/Casual search while others wait (the party's slots must be given back; `MsprMatchmaker.OnCancel`).
- Volcano Weekend (mode 10).
- Horizon on .NET 10 over several days (memory, CPU, `journalctl -u mspr-horizon`).

### Investigate
- Why a real PS3 posts its Ranked results only at the next SVO login ([findings](../research/findings.md#5-first-observations-of-a-real-ps3-live), [diagnostics](../guides/diagnostics.md#real-ps3-players-and-the-playstation-network)).
- `myPosition=true`: a request parameter of the leaderboard requests; the game accepts the answer without it, the expected answer is not confirmed ([speed-weekend](../research/speed-weekend.md)).
- Game rank / XP: the formula is decoded ([ranked-xp](../research/ranked-xp.md)); real stats blobs are still needed to confirm the counters at offsets 16-28 and 72.
- Announcement: check long text, line breaks and the empty case in the game ([announcements](../research/announcements.md)).
- Speed Weekend event specifics (tickets, targets, schedule) and whether a Weekend race posts a ghost (the Speed Weekend races seen had none).
- The PSN ticket signature of a real PS3 (`DefaultSigningKey`) against `server/src/svo/ticket.ts`; ticket version 4.0 (unsolved hash).

### Housekeeping
- The fixture ticket in `server/test/fixtures/svo` does not verify (altered); replace it by a synthetic one if the tests should check a signature end to end.
