# MSPR ranked / casual / leaderboards — reverse-engineered (EBOOT v1.03)


Source: `re/v103/EBOOT.elf` (update 1.03, decrypted with `rpcs3 --decrypt`), the original service
captures and `tools/` analysis. Decompiled output: `re/v103/decomp/*.c`.

## 1. Why ranked/casual never worked on the original service

In a capture of a Ranked session the game opens Ranked, the MLS
answers MatchParty with a **Referral** to the matchmaking server (MMS)
**192.168.2.103:10079**. That's a private LAN address, so the SYNs never get an
answer (3 attempts at t=103/152/196 s). The original service's MMS isn't reachable from the
internet.

## 2. The three systems involved

| What | System | Server |
|---|---|---|
| Party/lobby "rooms" (ROOM_IN_*), invites | NP Matching2 + NP Signaling | **RPCN** (works as-is in RPCS3) |
| Ranked leaderboard (`NPSCORE_BOARD_RANKED`, GetRankingByRange/NpId) | NP Score | **RPCN** |
| Finding a race: supersets, MatchParty, assigned game world | Medius MLS/MMS (lobby-ext msgs) | **our Horizon** (MsprMatchmaker) |
| Race itself | DME (ClientServerAuxUDP) | our Horizon DME |
| XP, rank level, ranked games/golds/streak, quit count | Medius account stats blob (256 B, MediusAccountUpdateStats) | our Horizon (now persisted) |
| Time attack / speed weekend boards, finishGame | SVO HTTP | our `server/svo` |

## 3. Client matchmaking flow (decompiled)

Online object = global at TOC-entry `0xe8fa0c`, vtable `0xe58e18`; its matchmaking
sub-object lives at `online + 0x7c0`.

| Script binding (GUI) | Implementation | Effect |
|---|---|---|
| `SetRankedOption` | vtbl+0x388 → `0x87ed48` | `online+0xff8 = 1` (ranked flag = mm+0x838) |
| `SetCasualOption` | vtbl+0x38c → `0x87ed58` | `online+0xff8 = 0` |
| `RankedOptionSelected` | vtbl+0x390 → `0x87ed68` | returns flag |
| superset choice | `0x884f58` | `online+0xff4` (= mm+0x834) = 1 or 2 via TEA RNG with fixed seed {1,1}. Static analysis predicted 2, but the real game sent **1**. The server answers both |
| `MatchMadeGameTypeString` | vtbl+0x344 → `0x281688` | string id 0x710 + (ranked ? 0 : 1) |

1. **MLS `MatchGetSupersetList`** (LobbyExt 0x5D, 40 B) → one `0x5E` per superset.
   The client keeps a list (entry+8 = SupersetID) and errors with
   *"Error Finding Match Make, SuperSetNot avaliable"* if superset 2 is missing.
2. **`MatchPartyRequest2`** (LobbyExt 0x78, 80 B for a solo player), built in `0x27d9e8`:
   SupersetID=2, PartySize, **MinGameSize = 4 casual / 6 ranked**, MaxGameSize = 12,
   MatchOptions = 2, AppData 12 B = `[ranked u8][0 0 0][avg rank level s32 BE][0×4]`,
   timeout 120 s.
3. **`MatchPartyResponse`** (LobbyExt **0x60**), handled in `0x2801d8`:
   * `8 MediusMatchTypeReferral` → copy NetConnectionInfo (0x9c) and connect to MMS, send again
   * `6 MediusJoinAssignedGame` → count players in roster, build a join (0xdc) and join the world.
     **Only valid on MMS**: the server must first answer `8 Referral` on MLS. The client then drops
     MLS, connects to MMS (connect type 4, info at online+0x298), resends 0x78, gets
     JoinAssignedGame, then asks MMS for its lobby with JoinLeastPopulatedChannel (LobbyExt
     0x71 -> 0x72 + NetConnectionInfo of MLS), leaves MMS and rejoins MLS for MediusJoinGame. If JoinAssignedGame is sent
     on MLS, the client drops the lobby and shows "There was a problem connecting to the server"
    .
   * `1 MediusNoResult` → "No Result from Party Join, Try again?"
   * `7 HostGame` → **ignored** by MSPR (Horizon's stock mock answer, which also uses the wrong type 0x79)
4. The race lobby auto-starts on the client (`CheckMatchMakingAutoStart`,
   *"MatchMaking can start. There are %d players"*). The track "ticket" is picked
   client-side and can be vetoed by majority vote.

## 4. Wire formats (Medius client lib registry `0x66af00`, serializers `0x67xxxx`)

The stream is packed: int = 4 B little-endian, char = 1 B, no alignment.

```
0x5E MatchGetSupersetListResponse  (unpack 0x6728e0)
  MessageID[21] Status:i32 EndOfList:u8 Status:i32 SupersetID:i32 Unknown:i32
  NameLen:i32 DescLen:i32 ExtraLen:i32 Name[NameLen] Desc[DescLen] Extra[ExtraLen]
  (the original service: 64 B incl. 2-byte header -> 12 bytes of strings)

0x78 MatchPartyRequest2  (pack 0x6714a8)
  MessageID[21] SessionKey[17] SupersetID PartySize MinGameSize MaxGameSize
  MatchOptions AppDataSize PartyAccountID[PartySize] AppData[AppDataSize]

0x60 MatchPartyResponse  (pack/unpack 0x6720e0)
  MessageID[21] Status:i32 PluginStatus:i32
  6: WorldID GamePassword[32] GameHostType AddressList[48] AppDataSize AppData[]
     RosterBytes NumParties { PartyBytes(=8n+8) NumPlayers { i32, AccountID } x n } x parties
  7: MatchGameID AppDataSize AppData[]
  8: MatchingWorldUID NetConnectionInfo[0x9c]   (191 B on the original service)

NetConnectionInfo (0x64e480) = Type AddressList[2 x 24] WorldID ServerKey[64]
                               SessionKey[17] AccessKey[17] pad[2]   = 156 B
```

The full registry (275 messages, class:type → pack/unpack function) is in
`re/v103/medius_registry.json`.

## 5. Server implementation (Horizon)

`horizon/Servers/Horizon/SERVER/Medius/Mspr/`:
* `MsprMessages.cs`: exact 0x5E / 0x60 serializers above.
* `MsprMatchmaker.cs`:
  * MLS: `ReferToMms` answers MatchPartyRequest2 with `8 Referral` (NetConnectionInfo of MMS with the
    client's own session/access keys, the advertised = public IP, 191 B like the original service).
  * MMS: `OnPartyRequest` buckets parties by (superset, ranked). The first party creates a DME world
    server-side (`MediusServerCreateGameWithAttributesRequest`, MessageID marker `-7`); later parties
    are assigned until 12 players are reserved. Every party gets `6 JoinAssignedGame` (DME address =
    the advertised IP). MPS calls `OnWorldCreated` when the DME confirms.
  * MMS: `SendBackToLobby` answers JoinLeastPopulatedChannel (0x71) with 0x72 + the MLS connect info.
  * The client object is kept alive (`KeepAliveUntilNextConnection`) across MLS → MMS → MLS.
  * `Snapshot()` feeds the status API (Horizon CRUD `/GetMspr/`).
* MMS fixes for this flow: its HELLO sent a zero RSA key, and its tick never sent the client object's
  queued Medius responses.
* Accounts and the 256-byte Medius stats blob are stored in the server's SQLite database through the
  loopback API `/horizon/accounts` (same account id as SVO).

Verified with `server/medius/e2e_check.py`: supersets [1, 2] → MLS referral → MMS MatchParty → world
created on DME → `JoinAssignedGame` → JoinLeastPopulatedChannel → back to MLS. Real game:
Ranked and Casual reach the race lobby.

## 6. Game bug: Custom Game settings overwritten

`CB_MatchParty` (`0x2801d8`) copies the 0xdc-byte join struct to `online+0x64c`, the block that also
holds the Custom Game settings (GameLevel = track at +0x6fc, generic fields). After a Ranked/Casual
match the next Custom Game is created with track 0 and mode 5, the map cannot be changed and has no
picture. Server-side nothing sets these values. Fix: RPCS3 patch `server/rpcs3/imported_patch.yml`
(`0x2804e4`: `li r5,0xdc` → `li r5,0xb0`, so only the fields needed to join are copied).

## 7. Still open

* Races with several real players (Ranked needs 6, Casual 4) and a real PS3 are untested.
* The 256-byte stats blob is decoded in part (XP at offset 8, quit count at 12, dropouts at 32; see
  [ranked-xp](../research/ranked-xp.md)); the golds, silvers and bronzes still need real blobs to be confirmed.
  In-game ranked leaderboards use RPCN/PSN NP Score.
* Real-game findings: SvoURL string = varint length + bytes incl. NUL (reader 0x648f18/0x648b68),
  the game sends LocationID -1 (Horizon GetFreeDme had to fall back to any DME). UniverseVariableInformation
  carries no SVO URL; the client copies it from the SvoURL message with the same MessageID (0x675008).
* Skill-based bucketing (AppData avg rank) is parsed but not used yet. Population is small.
