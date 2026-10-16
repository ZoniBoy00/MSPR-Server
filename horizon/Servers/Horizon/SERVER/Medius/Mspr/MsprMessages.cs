using System;
using Horizon.LIBRARY.Common.Stream;
using Horizon.RT.Common;
using Horizon.RT.Models;
using Horizon.RT.Models.Misc;

namespace Horizon.SERVER.Medius.Mspr
{
    // Wire formats below are taken from MotorStorm: Pacific Rift v1.03's Medius client
    // library serializers (re/v103/decomp/match_wire.c, wire_prims.c, wire_roster.c).
    // The stream is packed: int = 4 bytes LE, char = 1 byte, no alignment padding.

    /// <summary>
    /// LobbyExt 0x5E MatchGetSupersetListResponse (client unpack @0x6728e0):
    /// MessageID[21] StatusCode EndOfList(char) StatusCode SupersetID Unknown
    /// NameLen DescLen ExtraLen Name[NameLen] Desc[DescLen] Extra[ExtraLen]
    /// </summary>
    public class MsprSupersetListResponse : BaseLobbyExtMessage
    {
        public override byte PacketType => 0x5E;

        public MessageId MessageID { get; set; } = MessageId.Empty;
        public MediusCallbackStatus StatusCode = MediusCallbackStatus.MediusSuccess;
        public bool EndOfList;
        public int SupersetID;
        public int Unknown;
        public string Name = string.Empty;
        public string Description = string.Empty;
        public string ExtraInfo = string.Empty;

        public override void Serialize(MessageWriter writer)
        {
            byte[] name = System.Text.Encoding.ASCII.GetBytes(Name);
            byte[] desc = System.Text.Encoding.ASCII.GetBytes(Description);
            byte[] extra = System.Text.Encoding.ASCII.GetBytes(ExtraInfo);

            writer.Write(MessageID ?? MessageId.Empty);
            writer.Write((int)StatusCode);
            writer.Write((byte)(EndOfList ? 1 : 0));
            writer.Write((int)StatusCode);
            writer.Write(SupersetID);
            writer.Write(Unknown);
            writer.Write(name.Length);
            writer.Write(desc.Length);
            writer.Write(extra.Length);
            writer.Write(name);
            writer.Write(desc);
            writer.Write(extra);
        }

        public override void Deserialize(MessageReader reader) => throw new NotSupportedException();

        public override string ToString() =>
            base.ToString() + $" MessageID:{MessageID} StatusCode:{StatusCode} EndOfList:{EndOfList} SupersetID:{SupersetID} Name:{Name}";
    }

    /// <summary>
    /// LobbyExt 0x60 MatchPartyResponse (client unpack @0x6720e0). Horizon's stock
    /// MediusMatchPartyResponse is registered with type 0x79, which MSPR ignores.
    /// </summary>
    public class MsprMatchPartyResponse : BaseLobbyExtMessage
    {
        public override byte PacketType => 0x60;

        public MessageId MessageID { get; set; } = MessageId.Empty;
        public MediusCallbackStatus StatusCode;
        public int PluginSpecificStatusCode;

        // MediusJoinAssignedGame (6)
        public int GameWorldID;
        public string GamePassword = string.Empty;          // 32 bytes
        public MGCL_GAME_HOST_TYPE GameHostType = MGCL_GAME_HOST_TYPE.MGCLGameHostClientServerAuxUDP;
        public NetAddressList AddressList = new NetAddressList();
        public byte[] ApplicationData = Array.Empty<byte>();
        public int[][] Parties = Array.Empty<int[]>();      // roster: account ids per party

        // MediusMatchTypeReferral (8)
        public int MatchingWorldUID;
        public NetConnectionInfo? ConnectInfo;

        public override void Serialize(MessageWriter writer)
        {
            writer.Write(MessageID ?? MessageId.Empty);
            writer.Write((int)StatusCode);
            writer.Write(PluginSpecificStatusCode);

            switch ((int)StatusCode)
            {
                case 6: // MediusJoinAssignedGame
                    {
                        writer.Write(GameWorldID);
                        writer.Write(GamePassword ?? string.Empty, 0x20);
                        writer.Write((int)GameHostType);
                        writer.Write(AddressList);
                        writer.Write(ApplicationData.Length);
                        writer.Write(ApplicationData);

                        // roster size = numParties*4 + 8 + sum(party bytes), party bytes = 8 * players + 8
                        int rosterBytes = 8 + Parties.Length * 4;
                        foreach (int[] p in Parties)
                            rosterBytes += 8 * p.Length + 8;
                        writer.Write(rosterBytes);
                        writer.Write(Parties.Length);
                        foreach (int[] p in Parties)
                        {
                            writer.Write(8 * p.Length + 8);
                            writer.Write(p.Length);
                            foreach (int accountId in p)
                            {
                                writer.Write(0);          // read into entry+4
                                writer.Write(accountId);  // read into entry+0
                            }
                        }
                        break;
                    }
                case 7: // MediusMatchTypeHostGame
                    {
                        writer.Write(GameWorldID);
                        writer.Write(ApplicationData.Length);
                        writer.Write(ApplicationData);
                        break;
                    }
                case 8: // MediusMatchTypeReferral
                    {
                        writer.Write(MatchingWorldUID);
                        writer.Write(ConnectInfo ?? new NetConnectionInfo());
                        break;
                    }
            }
        }

        public override void Deserialize(MessageReader reader) => throw new NotSupportedException();

        public override string ToString() =>
            base.ToString() + $" MessageID:{MessageID} StatusCode:{StatusCode} GameWorldID:{GameWorldID} Parties:{Parties.Length}";
    }
}
