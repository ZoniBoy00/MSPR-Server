# What was changed for MotorStorm: Pacific Rift

`horizon/` is a reduced copy of the Horizon (Medius) part of PSMultiServer, which builds on the Horizon server of Dnawrkshp and Jump-Suit's extended fork (see [credits](../docs/project/credits.md)). This page lists what is specific to MotorStorm: Pacific Rift (application id 21624), so that the game's logic can be told from the inherited code and a later move to another base (or to an own server) knows what has to be carried over. Everything below is in this tree; the line `MSPR` or `MotorStorm` in a comment marks the spot.

## The game's own logic: `Servers/Horizon/SERVER/Medius/Mspr/`

| File | What it does |
|---|---|
| `MsprMatchmaker.cs` | Ranked and Casual matchmaking: answers the superset list, takes the party request (`MatchPartyRequest2`), makes a game when enough players are waiting, creates the DME world on the server and hands the players `JoinAssignedGame`; returns the whole party's slots when a search is cancelled. |
| `MsprMessages.cs` | The wire formats of the messages of that flow (`MatchGetSupersetListResponse`, `MatchPartyResponse` and so on), taken from the game's Medius client (EBOOT v1.03). |
| `MspMatchmadeCapacity.cs` | The rule that decides whether a game is listed as joinable (an underfilled Custom lobby must be visible). Has a small check in `Servers/Horizon.Tests`. |

## Where the game's logic touches the inherited code

| File | What is MotorStorm specific |
|---|---|
| `SERVER/Medius/MAS.cs` | 21624 is accepted with `CONNECT_ACCEPT_TCP` directly; the game's crypt key request; the ticket login refuses banned users (list and strikes come from the server). |
| `SERVER/Medius/MLS.cs` | 21624 in the lists of accepted and filtered games; the lobby refers a Ranked/Casual party to the MMS (the game only joins a world after a match made there); handling of the 30 s lobby timer of a match-made lobby. |
| `SERVER/Medius/MMS.cs` | The matchmaking server: any lobby channel will do, Ranked/Casual requests go to `MsprMatchmaker`, `JoinAssignedGame` is queued on the client object. |
| `SERVER/Medius/MPS.cs` | The game's crypt key request; the world created server-side for a match-made game. |
| `SERVER/MediusClass.cs`, `Program.cs` | The tick phases are timed: one slow await stalled every Medius server and the game gives up after 10 s (it timed out on `GetLocations` after 21 s). |
| `MUIS/MUIS.cs`, `MUIS/MuisClass.cs` | 21624 is accepted with `CONNECT_ACCEPT_TCP`; the universe entry of the game (the `SvoURL` points to the SVO service). |
| `MUM/Models/ClientObject.cs` | The game sends `MediusPlayerReport` exactly every 30 s, the same as the default timeout: the timeout for 21624 is longer (otherwise a report a few ms late logged the player out). |
| `MUM/Models/GameListFilter.cs` | The game always sends 0 as "matchmaking games" for the Custom Game list. |
| `MUM/MumManager.cs`, `HTTPSERVICE/CrudServerHandler.cs` | A snapshot of all games of an application (`/GetRooms/`) for the server's status API. |
| `DME/*` | 21624 in the accepted applications; the DME's connections to MAS and MPS. |
| `static/ebootdefs.json` | The game's entry. |

## Messages and formats (`AuxiliaryServices/HorizonService/RT.Models`)

| File | What |
|---|---|
| `Lobby/MediusUniverseSvoURLResponse.cs` | The `SvoURL` message in the format the game's reader expects (a varint length, byte-identical to the original service). |
| `Lobby/MediusUniverseVariableInformationResponse.cs` | The universe information of 21624, byte-identical to the original service. |
| `Lobby/MediusMatchPartyRequest.cs` | The 12-byte application data of the party request (ranked flag and average rank level). |
| `VerboseLog.cs` | Per-message logging for release builds: `HORIZON_LOG_LEVEL=quiet|normal|full`; `HORIZON_VERBOSE=1` logs every decoded message. |

## Accounts and tickets

| File | What |
|---|---|
| `LIBRARY.Database/DbController.cs` | Accounts and stats are kept by the server's loopback API (`/horizon/accounts`) instead of a separate database; the account id is the same as at the SVO login. |
| `BackendServices/CastleLibrary/S0ny/XI5/XI5Ticket.cs` | The NP ticket check at the Medius login: RPCN and PSN signatures. `HORIZON_XI5_IGNORE_EXPIRY=1` (tests) ignores the expiry; with `HORIZON_XI5_TEST_PUBKEY` it also trusts a test key (test mode only, see `tools/medius/README.md`). |

## Operational changes (not about the game)

| Where | What |
|---|---|
| `Servers/Horizon/EventLoops.cs` | The number of I/O threads per pool (`HORIZON_IO_THREADS`, default 4): the default configuration started services for dozens of games and about 1800 threads. |
| `SERVER/Medius/MMS.cs` (`Tick`) | `Group.ToArray()` before enumerating the channel group: on .NET 8 and later enumerating an empty `DefaultChannelGroup` never ends, which froze every Medius answer. |
| `BackendServices/MultiServerLibrary/InitLock.cs` | A process-local fallback where a named machine-wide mutex cannot be created (the hardened systemd service). |
| `Servers/Horizon/TaskExtensions.cs`, `DME/MASClient.cs`, `DME/MPSClient.cs`, `DME/Models/DMEObject.cs` | `TryAwait`: closing a channel or stopping an event loop has a time limit; `Stop()` is not awaited in the connection-lost handlers and runs once per client. |
| `DME/Models/World.cs`, `RT.Cryptography/CipherService.cs` | A direct lookup of the target client by DME id; an atomic cipher table (ideas of the upstream horizon-server). |
| `scripts/Start-MSPRServer.ps1` | One application only (21624): the other universes are removed from MUIS, the BWPS (bandwidth probe), MAPS (profile server and its ports 10471/10472/10475) and the metrics endpoint are switched off, the other applications are not started. |

The game was never seen to use the bandwidth probe or the profile server in the captures of the original service.
