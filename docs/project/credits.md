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

## Further sources found during the research

Read while looking for how the game, the PS3 and the revival projects work. Some gave a fact, some only ruled something out; none of their code is included.

| Source | What it was about |
|---|---|
| [PS Rewired guide for PS3](https://psrewired.com/guides/ps3), [for RPCS3](https://psrewired.com/guides/rpcs3), [server page of the game](https://psrewired.com/servers/21624) | The public setup (DNS only on a real PS3, UPnP, the RPCS3 host name) and the game's application id 21624. |
| [PSU: MotorStorm PS3 online servers restored by fan group PSONE](https://www.psu.com/news/motorstorm-ps3-online-servers-restored-by-fan-group-psone/), [Overclockers thread on PSONE](https://forums.overclockers.co.uk/threads/psone-online-ps3-servers-revival.18942488/) | What PSONE offers and how a console is pointed at it. |
| [regallll/motorstorm-modding-resources](https://github.com/regallll/motorstorm-modding-resources/blob/main/README.md), [MotorStorm modding notes](https://thenorwegiandud.wixsite.com/msclub/modding) | What is known about the game's files. |
| [PSORG: packet-captures](https://github.com/PSOnlineReturnalGaming/packet-captures), [SVO_Stats_Analyzer](https://github.com/PSOnlineReturnalGaming/SVO_Stats_Analyzer), [Game-Utils](https://github.com/PSOnlineReturnalGaming/Game-Utils) and [Dnawrkshp/uya-medius-encryption](https://github.com/Dnawrkshp/uya-medius-encryption) | Captures and notes on the Medius and SVO side of other games. |
| [RPCN ticket code](https://github.com/RipleyTom/rpcn/blob/master/src/server/client/ticket.rs), [RPCN configuration](https://github.com/RipleyTom/rpcn/blob/master/rpcn.cfg), [RPCN issue 111](https://github.com/RipleyTom/rpcn/issues/111) | How RPCN builds and signs NP tickets, which the ticket check follows. |
| [Netflix MSL: NP ticket entity authentication](https://github.com/Netflix/msl/wiki/NP-Ticket-Entity-Authentication) | A second description of the NP ticket structure. |
| [PS3 Developer Wiki: PSN](https://www.psdevwiki.com/ps3/PSN), [Online connections](https://www.psdevwiki.com/ps3/Online_Connections) | How the PS3 reaches its online services. |
| [RPCS3 wiki: Netplay](https://wiki.rpcs3.net/index.php?title=Help%3ANetplay), [PlayStation Home](https://wiki.rpcs3.net/index.php?title=PlayStation%3A_Home), [compatibility list](https://rpcs3.net/compatibility?g=motorstorm), [ResetEra thread on RPCS3 PSN emulation](https://www.resetera.com/threads/rpcs3-introducing-online-play-via-psn-emulation.259446/) | How RPCS3 networking and RPCN work. |
| RPCS3 [issue 6680](https://github.com/RPCS3/rpcs3/issues/6680), [issue 9314](https://github.com/RPCS3/rpcs3/issues/9314), [issue 16617](https://github.com/RPCS3/rpcs3/issues/16617), [pull request 8879](https://github.com/RPCS3/rpcs3/pull/8879) | Network behaviour of the emulator that mattered for testing. |
| [hashsploit's wiki: PlayStation 2 Medius](https://wiki.hashsploit.net/PlayStation_2#Medius), [LittleBigPatcher for custom servers](https://github.com/LittleBigPatcherTeam/LittleBigPatcher-for-Custom-Servers-PS3-Homebrew) | Medius background; how another game is pointed at a custom server. |
| [libcurl-ps3 SSL certificates](https://github.com/kakaroto/libcurl-ps3/blob/master/docs/SSLCERTS), [ps3mfw `change_ssl_cer`](https://github.com/skrptktty/ps3-firmware-beginners-luck/blob/master/ps3mfw/tasks/change_ssl_cer.tcl), [PSX-Place: SSL certificate injector](https://www.psx-place.com/threads/ps3xploit-v3-ssl-certificate-injector-remover.17200/page-3), [BGToolset SSL issue](https://www.psx-place.com/threads/update-ssl-issue-resolved-bg-toolset-ssl-issues-80710a06-error-july-2024.44151/) | Why the PS3's certificate store cannot be replaced without custom firmware (the game's SVO is plain HTTP, so none is needed). |
| [PSX-Place: PS3 game server by modifying DNS](https://www.psx-place.com/threads/new-ps3-game-server-by-modifying-dns.37900/), [PlayStation Home on PSORG](https://www.psx-place.com/threads/playstation-home-1-00-17-online-on-psorg.40000/), [Al-Azif/exploit-host-dns](https://github.com/Al-Azif/exploit-host-dns), [webMAN MOD: PS3 NET server](https://github.com/aldostools/webMAN-MOD/wiki/~-PS3-NET-Server) | How other PS3 revival setups use DNS. |
| [TCRF: MotorStorm](https://tcrf.net/MotorStorm), [Wikipedia: MotorStorm: Pacific Rift](https://en.wikipedia.org/wiki/MotorStorm:_Pacific_Rift) | General facts about the game. |

## Built with AI assistance

Large parts of the code, the analysis and the documentation of this project were written with [Claude](https://claude.com/claude-code) (Anthropic), working under the direction of the maintainer, who set the goals, ran the game tests (RPCS3, and first tests on a real PS3), supplied the captures and decided what to build. Claude read and decompiled code, wrote and ran the scripts and tests, searched the public sources listed on this page, and drafted the text. Findings in the reports are tagged with their evidence (`[EBOOT]`, `[CAPTURE]`, `[LIVE]`, `[SOURCE]`, `[INFERENCE]`) so that what was observed can be told from what was concluded.

The game itself, MotorStorm: Pacific Rift, is by Evolution Studios and Sony Interactive Entertainment. This project is not affiliated with or endorsed by them.

## What is original here

The server for this game: the SVO service (login, EULA, leaderboards, ghosts, Weekend boards, results), the Ranked and Casual matchmaking over Medius, the DNS and status services, the account database, the anti-cheat and diagnostics, the RPCS3 patch, and the reverse engineering notes in [docs/research](../research). The full reverse engineering material (reports, redacted captures, analysis tools) is in the sibling repository [MSPR-RE](https://github.com/ZoniBoy00/MSPR-RE).
