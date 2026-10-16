# Credits and sources

This server stands on the work and the public information of other people. This page says what helped and in what way, so that nobody is credited for more than they did and nobody is left out.

## Code this repository is derived from

| Project | What it is here |
|---|---|
| [PSMultiServer / PSHome-MultiServer](https://github.com/GitHubProUser67/PSHome-MultiServer) by GitHubProUser67 and contributors | `horizon/` is a reduced copy of it: only the projects Horizon needs are kept. GPL-3.0, see `horizon/LICENSE`. |
| [Horizon](https://github.com/Horizon-Private-Server/horizon-server) (started by Dnawrkshp for Ratchet: Deadlocked) and [Jump-Suit's extended fork](https://github.com/Jump-Suit/horizon-server-public-extended) | The open-source Medius implementation (MUIS, MAS, MLS, DME ...) at the core of PSMultiServer's Horizon. The MSPR matchmaking, game list rules and account storage were added on top. |
| [RPCS3](https://github.com/RPCS3/rpcs3) and [RPCN](https://github.com/RipleyTom/rpcn) by RipleyTom | The emulator the game is played on, and its NP server. RPCN's ticket signature (public key, ticket layout) is what the NP ticket check follows. |

The licences of the libraries inside `horizon/` are listed in [NOTICE](../../NOTICE.md) (public repository) and kept in their folders.

## Projects whose public information helped

Elsewhere in the documentation the former service of this game is called "the original service". None of the code of these projects is included; their documentation, descriptions and public behaviour were used to understand how the game's online side works and what a revival has to provide.

| Project or source | How it helped |
|---|---|
| **PS Rewired** ([psrewired.com](https://psrewired.com/)) | The former online service of MotorStorm: Pacific Rift for PS3 and RPCS3. Recorded requests and responses of its SVO and Medius traffic were analysed to learn the protocol; the replay tests of this repository use such recordings, and its public setup guide shows how a real PS3 is pointed at a replacement server (DNS only). |
| **PSONE** (PlayStation Online Network Emulated; [overview on PSXHAX](https://www.psxhax.com/threads/psone-playstation-online-network-emulated-for-ps3-multiplayer-gaming.10406/)) | Showed that a real PS3 with a PSN account can use a replacement server through a DNS change alone. |
| **PSORG** ([PSOnlineReturnalGaming](https://github.com/PSOnlineReturnalGaming)) | Its public repositories (`packet-captures`, `uya-medius-encryption`, `SVO_Stats_Analyzer`, `Game-Utils`) and the references they point to describe the Medius and SVO side of other PS3 and PS2 games. |
| [clank](https://github.com/xtvaser/clank) (a Medius emulator, now deprecated) and the Medius protocol notes of [hashsploit's wiki](https://wiki.hashsploit.net/PlayStation_3:Protocol) | Background on the Medius message and component structure. |
| [LittleBigRefresh/NPTicket](https://github.com/LittleBigRefresh/NPTicket) | A public library for reading and verifying NP tickets; listed as a reference for the approach. |
| [PS3 Developer Wiki](https://www.psdevwiki.com/ps3/X-I-5-Ticket) | The layout of the NP (XI5) ticket. |
| [RPCS3 wiki](https://wiki.rpcs3.net/index.php?title=MotorStorm%3A_Pacific_Rift) (Netplay, MotorStorm: Pacific Rift) and [RPCS3 issue 13126](https://github.com/RPCS3/rpcs3/issues/13126) | What RPCS3 players need, and how large lobbies behaved on the former service. |
| Articles and threads about the revival of PS3 online games ([Push Square](https://www.pushsquare.com/news/2021/11/a-group-of-fans-are-reviving-ps3s-online-multiplayer-with-emulated-servers), [PSNProfiles](https://forum.psnprofiles.com/topic/137321-ps-rewired-now-has-a-custom-server-as-well/), [GameFAQs](https://gamefaqs.gamespot.com/boards/928393-motorstorm/79774551)) | Background on what worked and what did not for other revival projects. |
| .NET, dotnet/runtime [issue 105576](https://github.com/dotnet/runtime/issues/105576) | The enumeration of an empty channel group that never ends on .NET 8 and later. |

The game itself, MotorStorm: Pacific Rift, is by Evolution Studios and Sony Interactive Entertainment. This project is not affiliated with or endorsed by them.

## What is original here

The server for this game: the SVO service (login, EULA, leaderboards, ghosts, Weekend boards, results), the Ranked and Casual matchmaking over Medius, the DNS and status services, the account database, the anti-cheat and diagnostics, the RPCS3 patch, and the reverse engineering notes in [docs/research](../research).
