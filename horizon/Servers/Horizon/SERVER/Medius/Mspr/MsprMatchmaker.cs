using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using CustomLogger;
using Horizon.MUM.Models;
using Horizon.RT.Common;
using Horizon.RT.Models;
using Horizon.RT.Models.Lobby;
using Horizon.RT.Models.Misc;

namespace Horizon.SERVER.Medius.Mspr
{
    /// <summary>
    /// Ranked / casual matchmaking for MotorStorm: Pacific Rift (app 21624).
    ///
    /// Client flow (reversed from EBOOT v1.03, see docs/RANKED-CASUAL.md):
    ///   MLS  MatchGetSupersetList (0x5D) -> one 0x5E per superset; the game always asks for superset 2
    ///   MLS  MatchPartyRequest2 (0x78)  {superset, party size, min 4 casual / 6 ranked, max 12,
    ///                                     party account ids, 12 bytes app data: ranked flag + avg rank}
    ///   ->   MatchPartyResponse (0x60) 8 Referral: client connects to MMS (connect info at online+0x298)
    ///   MMS  MatchPartyRequest2 again -> 6 JoinAssignedGame (join world) / 1 NoResult (client retries).
    ///        7 HostGame is ignored. JoinAssignedGame answered on MLS itself makes the client drop the
    ///        lobby connection and fail with "problem connecting to the server".
    ///   client then leaves MMS, reconnects to MLS, MediusJoinGame(world) -> DME; the race lobby auto-starts.
    ///
    /// The server therefore owns game creation: the first party of a bucket creates a DME world,
    /// later parties with the same (superset, ranked) bucket are assigned to it until it is full.
    /// </summary>
    public static class MsprMatchmaker
    {
        public const int AppId = 21624;
        public const int PartyTypeMatchmade = 7;   // marker in the DME create-game MessageID
        private const int MaxGameSize = 12;
        private static readonly TimeSpan OpenFor = TimeSpan.FromMinutes(10);
        /// <summary>A party that was assigned to a world counts as present this long, so its players have time to connect.</summary>
        private static readonly TimeSpan JoinGrace = TimeSpan.FromSeconds(90);

        /// <summary>Test switch (Start-MSPRServer.ps1 -TestMinPlayers N): advertise N as the matchmade game's minimum.</summary>
        private static readonly int? MinPlayersOverride =
            int.TryParse(Environment.GetEnvironmentVariable("MSPR_MM_MIN_PLAYERS"), out int n) && n > 0 ? n : null;

        private sealed class Ticket
        {
            public ClientObject Client = null!;
            public MessageId MessageID = MessageId.Empty;
            public int[] AccountIds = Array.Empty<int>();
        }

        private sealed class MatchGame
        {
            public int SupersetID;
            public bool Ranked;
            public Game? Game;
            public bool Created;
            public bool Failed;
            public int Reserved;
            public DateTime OpenedUtc = DateTime.UtcNow;
            public byte[] AppData = Array.Empty<byte>();
            public readonly List<Ticket> Waiting = new();
            public readonly List<int[]> Parties = new();
            public readonly Dictionary<int[], DateTime> PartyAddedUtc = new();
        }

        private static readonly object _lock = new();
        private static readonly List<MatchGame> _games = new();
        private static int _gameCounter;

        public static readonly (int Id, string Name)[] Supersets = { (1, "MSPR_1"), (2, "MSPR_2") };

        public static void SendSupersetList(ClientObject client, MediusMatchGetSupersetListRequest request)
        {
            for (int i = 0; i < Supersets.Length; i++)
            {
                client.Queue(new MsprSupersetListResponse()
                {
                    MessageID = request.MessageID,
                    StatusCode = MediusCallbackStatus.MediusSuccess,
                    EndOfList = i == Supersets.Length - 1,
                    SupersetID = Supersets[i].Id,
                    Name = Supersets[i].Name,
                    Description = Supersets[i].Name,
                    ExtraInfo = string.Empty,
                });
            }
        }

        /// <summary>
        /// Brings the bucket's counts back in line with the world: players who left no longer hold a slot and parties that are
        /// gone are dropped from the roster that new players receive. A party that was assigned a moment ago still counts, because
        /// its players are on their way to the world. Call with <c>_lock</c> held.
        /// </summary>
        private static void Refresh(MatchGame g)
        {
            if (!g.Created || g.Game == null)
                return;
            var present = new HashSet<int>();
            lock (g.Game.LocalClients)
            {
                foreach (var c in g.Game.LocalClients)
                    if (c?.Client != null)
                        present.Add(c.Client.AccountId);
            }
            var now = DateTime.UtcNow;
            foreach (var p in g.Parties.ToList())
            {
                bool recent = g.PartyAddedUtc.TryGetValue(p, out var added) && now - added < JoinGrace;
                if (!recent && !p.Any(present.Contains))
                {
                    g.Parties.Remove(p);
                    g.PartyAddedUtc.Remove(p);
                }
            }
            g.Reserved = g.Parties.Sum(p => p.Length);
        }

        public static async Task OnPartyRequest(ClientObject client, MediusMatchPartyRequest request)
        {
            bool ranked = request.ApplicationDataBytes.Length > 0 && request.ApplicationDataBytes[0] != 0;
            int[] party = (request.PartyAccountIDList != null && request.PartyAccountIDList.Length > 0)
                ? request.PartyAccountIDList : new[] { client.AccountId };
            var ticket = new Ticket { Client = client, MessageID = request.MessageID, AccountIds = party };

            LoggerAccessor.LogInfo($"[MSPR-MM] party request from {client.AccountName} superset={request.SupersetID} ranked={ranked} " +
                                   $"party={party.Length} min={request.MinGameSize} max={request.MaxGameSize}");

            MatchGame? target;
            bool create = false;
            lock (_lock)
            {
                _games.RemoveAll(g => g.Failed || DateTime.UtcNow - g.OpenedUtc > OpenFor
                                      // a world that ended (e.g. the lobby timer ran out below the minimum player count)
                                      // is gone from the MUM cache; assigning new parties to it ends in "connection lost"
                                      || (g.Game != null && (g.Game.Destroyed || g.Game.WorldStatus == MediusWorldStatus.WorldClosed)));
                foreach (var g in _games)
                    Refresh(g);
                target = _games.FirstOrDefault(g => g.SupersetID == request.SupersetID && g.Ranked == ranked
                                                    && g.Reserved + party.Length <= Math.Min(MaxGameSize, Math.Max(request.MaxGameSize, 1)));
                if (target == null)
                {
                    target = new MatchGame { SupersetID = request.SupersetID, Ranked = ranked, AppData = request.ApplicationDataBytes };
                    _games.Add(target);
                    create = true;
                }
                target.Reserved += party.Length;
                target.Parties.Add(party);
                target.PartyAddedUtc[party] = DateTime.UtcNow;
                if (!target.Created)
                    target.Waiting.Add(ticket);
            }

            if (create)
            {
                if (!await CreateWorld(client, request, target))
                {
                    lock (_lock) { target.Failed = true; }
                    FailWaiting(target);
                }
                return;
            }

            if (target.Created && target.Game != null)
                Assign(target, ticket);
        }

        private static string AdvertisedDmeIp(ClientObject dme)
        {
            var ip = Horizon.DME.DmeClass.SERVER_IP;
            return ip != null && !ip.Equals(System.Net.IPAddress.None) && !ip.Equals(System.Net.IPAddress.Any)
                ? ip.MapToIPv4().ToString()
                : dme.IP.MapToIPv4().ToString();
        }

        /// <summary>MLS: send the party to the matchmaking server (MMS) with the client's own session keys.</summary>
        public static void ReferToMms(ClientObject client, MediusMatchPartyRequest request)
        {
            var mms = MediusClass.MatchmakingServer;
            string ip = !string.IsNullOrEmpty(MediusClass.Settings.NpMLSIpOverride) ? MediusClass.Settings.NpMLSIpOverride : mms.IPAddress.ToString();
            int lobbyId = MediusClass.Manager.GetOrCreateDefaultLobbyChannel(client.ApplicationId, client.MediusVersion).Id;
            client.KeepAliveUntilNextConnection();   // the client drops the lobby connection to go to MMS
            client.Queue(new MsprMatchPartyResponse()
            {
                MessageID = request.MessageID,
                StatusCode = MediusCallbackStatus.MediusMatchTypeReferral,
                MatchingWorldUID = lobbyId,
                ConnectInfo = new NetConnectionInfo()
                {
                    AccessKey = client.AccessToken,
                    SessionKey = client.SessionKey,
                    TargetWorldID = lobbyId,
                    ServerKey = new RSA_KEY(),
                    AddressList = new NetAddressList()
                    {
                        AddressList = new NetAddress[Constants.NET_ADDRESS_LIST_COUNT]
                        {
                            new NetAddress() { Address = ip, Port = mms.TCPPort, AddressType = NetAddressType.NetAddressTypeExternal },
                            new NetAddress() { AddressType = NetAddressType.NetAddressNone },
                        }
                    },
                    Type = NetConnectionType.NetConnectionTypeClientServerTCP
                },
            });
            LoggerAccessor.LogInfo($"[MSPR-MM] {client.AccountName} referred to MMS {ip}:{mms.TCPPort}");
        }

        /// <summary>MMS: JoinLeastPopulatedChannel after the match -> connection info of the lobby (MLS) to rejoin.</summary>
        public static void SendBackToLobby(ClientObject client, MediusJoinLeastPopulatedChannelRequest request)
        {
            var channel = MediusClass.Manager.GetOrCreateDefaultLobbyChannel(client.ApplicationId, client.MediusVersion);
            string ip = !string.IsNullOrEmpty(MediusClass.Settings.NpMLSIpOverride) ? MediusClass.Settings.NpMLSIpOverride : MediusClass.LobbyServer.IPAddress.ToString();
            int port = MediusClass.Settings.NpMLSPortOverride != -1 ? MediusClass.Settings.NpMLSPortOverride : MediusClass.LobbyServer.TCPPort;
            client.KeepAliveUntilNextConnection();   // the client leaves MMS and reconnects to MLS
            client.Queue(new MediusJoinLeastPopulatedChannelResponse()
            {
                MessageID = request.MessageID,
                StatusCode = MediusCallbackStatus.MediusSuccess,
                MediusWorldID = channel.Id,
                ConnectInfo = new NetConnectionInfo()
                {
                    AccessKey = client.AccessToken,
                    SessionKey = client.SessionKey,
                    TargetWorldID = channel.Id,
                    ServerKey = MediusClass.GlobalAuthPublic,
                    AddressList = new NetAddressList()
                    {
                        AddressList = new NetAddress[Constants.NET_ADDRESS_LIST_COUNT]
                        {
                            new NetAddress() { Address = ip, Port = port, AddressType = NetAddressType.NetAddressTypeExternal },
                            new NetAddress() { AddressType = NetAddressType.NetAddressNone },
                        }
                    },
                    Type = NetConnectionType.NetConnectionTypeClientServerTCP
                }
            });
            LoggerAccessor.LogInfo($"[MSPR-MM] {client.AccountName} sent back to lobby {ip}:{port} channel {channel.Id}");
        }

        /// <summary>
        /// Live MSPR state for the status API (Horizon CRUD /GetMspr/): every game (custom / ranked / casual)
        /// with its players and settings, plus the matchmaking buckets and parties still waiting for a world.
        /// </summary>
        public static object Snapshot()
        {
            List<MatchGame> mm;
            lock (_lock) { foreach (var g in _games) Refresh(g); mm = _games.ToList(); }
            string TypeOf(Game g)
            {
                var m = mm.FirstOrDefault(x => x.Game == g);
                return m == null ? "custom" : m.Ranked ? "ranked" : "casual";
            }
            var games = MediusClass.Manager.GetGamesSnapshot(AppId).Where(g => !g.Destroyed).Select(g =>
            {
                List<Game.GameClient> clients;
                lock (g.LocalClients) { clients = g.LocalClients.ToList(); }
                return new
                {
                    worldId = g.MediusWorldId,
                    name = g.GameName,
                    type = TypeOf(g),
                    status = g.WorldStatus.ToString(),
                    host = g.Host?.AccountName,
                    players = clients.Where(c => c.Client != null).Select(c => new { accountId = c.Client!.AccountId, name = c.Client.AccountName, inGame = c.InGame }).ToList(),
                    playerCount = g.PlayerCount,
                    minPlayers = g.MinPlayers,
                    maxPlayers = g.MaxPlayers,
                    track = g.GameLevel,   // MSPR stores the track in GameLevel
                    genericFields = new[] { g.GenericField1, g.GenericField2, g.GenericField3, g.GenericField4, g.GenericField5, g.GenericField6, g.GenericField7, g.GenericField8 },
                    createdUtc = g.utcTimeCreated,
                    startedUtc = g.utcTimeStarted,
                };
            }).ToList();
            var matchmaking = mm.Select(m => new
            {
                type = m.Ranked ? "ranked" : "casual",
                supersetId = m.SupersetID,
                worldId = m.Game?.MediusWorldId,
                created = m.Created,
                failed = m.Failed,
                reserved = m.Reserved,
                parties = m.Parties.Select(p => p.ToArray()).ToList(),
                waiting = m.Waiting.Select(t => t.Client.AccountName).ToList(),
                openedUtc = m.OpenedUtc,
            }).ToList();
            var players = MediusClass.Manager.GetClients(AppId).Where(x => x.IsLoggedIn).Select(x => new
            {
                accountId = x.AccountId,
                name = x.AccountName,
                worldId = x.CurrentGame?.MediusWorldId,
                game = x.CurrentGame?.GameName,
            }).ToList();
            return new { appId = AppId, players, games, matchmaking };
        }

        public static void OnCancel(ClientObject client)
        {
            lock (_lock)
            {
                foreach (var g in _games)
                {
                    // give back the whole party's slots (not one) and forget the party, so the bucket's capacity and roster stay right
                    foreach (var t in g.Waiting.Where(t => t.Client == client).ToList())
                    {
                        g.Waiting.Remove(t);
                        g.Reserved = Math.Max(0, g.Reserved - t.AccountIds.Length);
                        g.Parties.Remove(t.AccountIds);
                        g.PartyAddedUtc.Remove(t.AccountIds);
                    }
                }
            }
        }

        private static async Task<bool> CreateWorld(ClientObject host, MediusMatchPartyRequest request, MatchGame mg)
        {
            var dme = MediusClass.ProxyServer.GetFreeDme(host.ApplicationId, host.LocationId);
            if (dme == null)
            {
                LoggerAccessor.LogError("[MSPR-MM] no DME server registered for MSPR, cannot create matchmade world");
                return false;
            }

            int n = System.Threading.Interlocked.Increment(ref _gameCounter);
            var create = new MediusMatchCreateGameRequest()
            {
                MessageID = request.MessageID,
                SessionKey = request.SessionKey,
                SupersetID = request.SupersetID,
                ApplicationID = host.ApplicationId,
                MinPlayers = MinPlayersOverride ?? Math.Max(1, request.MinGameSize),
                MaxPlayers = MaxGameSize,
                GameLevel = 0,
                GameName = $"{(mg.Ranked ? "Ranked" : "Casual")} {n}",
                GamePassword = string.Empty,
                SpectatorPassword = string.Empty,
                GameHostType = MGCL_GAME_HOST_TYPE.MGCLGameHostClientServerAuxUDP,
                ApplicationDataSize = (uint)mg.AppData.Length,
            };

            try
            {
                var game = new Game(host, create, dme);
                game.IsMsprMatchmade = true;
                await MediusClass.Manager.AddGame(game);
                lock (_lock) { mg.Game = game; }

                dme.Queue(new MediusServerCreateGameWithAttributesRequest()
                {
                    MessageID = new MessageId($"{game.MediusWorldId}-{host.AccountId}-mm{n}-{PartyTypeMatchmade}"),
                    WorldID = game.GameChannel!.Id,
                    Attributes = game.Attributes,
                    ApplicationID = host.ApplicationId,
                    MaxClients = game.MaxPlayers
                });
                LoggerAccessor.LogInfo($"[MSPR-MM] creating world for '{create.GameName}' (game {game.MediusWorldId}) on DME {dme.IP}:{dme.Port}");
                return true;
            }
            catch (Exception e)
            {
                LoggerAccessor.LogError($"[MSPR-MM] world creation failed: {e}");
                return false;
            }
        }

        /// <summary>Called by MPS when the DME confirms (or rejects) a matchmade world.</summary>
        public static async Task OnWorldCreated(Game? game, int worldId, bool success)
        {
            MatchGame? mg;
            List<Ticket> waiting;
            lock (_lock)
            {
                mg = _games.FirstOrDefault(g => g.Game == game && game != null);
                if (mg == null)
                    return;
                if (!success)
                    mg.Failed = true;
                else
                    mg.Created = true;
                waiting = mg.Waiting.ToList();
                mg.Waiting.Clear();
            }

            if (!success || game == null)
            {
                FailWaiting(mg, waiting);
                if (game != null)
                    await game.EndGame(AppId);
                return;
            }

            game.MediusWorldId = game.GameChannel!.Id = worldId;
            await game.GameCreated();
            foreach (var t in waiting)
                Assign(mg, t);
        }

        private static void Assign(MatchGame mg, Ticket t)
        {
            var game = mg.Game!;
            var dme = game.DMEServer;
            int[][] parties;
            lock (_lock) { parties = mg.Parties.ToArray(); }

            t.Client.Queue(new MsprMatchPartyResponse()
            {
                MessageID = t.MessageID,
                StatusCode = MediusCallbackStatus.MediusJoinAssignedGame,
                GameWorldID = game.MediusWorldId,
                GameHostType = MGCL_GAME_HOST_TYPE.MGCLGameHostClientServerAuxUDP,
                AddressList = new NetAddressList()
                {
                    AddressList = new NetAddress[Constants.NET_ADDRESS_LIST_COUNT]
                    {
                        dme != null
                            // advertised (public) DME address: dme.IP is the DME's internal connection to MPS (LAN), which
                            // only works on the host's own network - the same class of bug as the original service's LAN MMS referral
                            ? new NetAddress() { Address = AdvertisedDmeIp(dme), Port = dme.Port, AddressType = NetAddressType.NetAddressTypeExternal }
                            : new NetAddress() { AddressType = NetAddressType.NetAddressNone },
                        new NetAddress() { AddressType = NetAddressType.NetAddressNone }
                    }
                },
                ApplicationData = mg.AppData,
                Parties = parties,
            });
            t.Client.KeepAliveUntilNextConnection();   // the client leaves MMS and comes back to MLS to join
            LoggerAccessor.LogInfo($"[MSPR-MM] {t.Client.AccountName} -> world {game.MediusWorldId} ({mg.Reserved}/{MaxGameSize} reserved)");
        }

        private static void FailWaiting(MatchGame mg, List<Ticket>? waiting = null)
        {
            waiting ??= mg.Waiting.ToList();
            foreach (var t in waiting)
                t.Client.Queue(new MsprMatchPartyResponse()
                {
                    MessageID = t.MessageID,
                    StatusCode = MediusCallbackStatus.MediusNoResult,   // client offers "Try again?"
                });
        }
    }
}
