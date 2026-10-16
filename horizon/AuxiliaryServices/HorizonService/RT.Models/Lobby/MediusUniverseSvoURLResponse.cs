using System.IO;
using Horizon.RT.Common;
using Horizon.LIBRARY.Common.Stream;

namespace Horizon.RT.Models
{
    [MediusMessage(NetMessageClass.MessageClassLobbyExt, MediusLobbyExtMessageIds.UniverseSvoURLResponse)]
    public class MediusUniverseSvoURLResponse : BaseLobbyExtMessage, IMediusResponse
    {
        public override byte PacketType => (byte)MediusLobbyExtMessageIds.UniverseSvoURLResponse;

        public bool IsSuccess => true;

        public MessageId MessageID { get; set; }

        public string URL { get; set; }

        public override void Deserialize(MessageReader reader)
        {
            base.Deserialize(reader);

            MessageID = reader.Read<MessageId>();

            // read URL
            if (reader.MediusVersion >= 109)
            {
                // 1 byte length prefixed url
                byte len = reader.ReadByte();
                URL = reader.ReadString(len + 1);
            }
            else
            {
                // fixed size url
                URL = reader.ReadString(128);
            }
        }

        /// <summary>varint(len+1) + URL + NUL, zero-padded so that varint + data = fieldSize bytes.</summary>
        public static void WriteMsprUrl(MessageWriter writer, string? url, int fieldSize)
        {
            byte[] text = System.Text.Encoding.ASCII.GetBytes(url ?? string.Empty);
            int len = text.Length + 1;
            int header = len <= 0x7F ? 1 : 2;
            if (header == 1)
                writer.Write((byte)len);
            else
            {
                writer.Write((byte)(0x80 | (len >> 8)));
                writer.Write((byte)(len & 0xFF));
            }
            byte[] data = new byte[System.Math.Max(len, fieldSize - header)];
            System.Array.Copy(text, data, text.Length);
            writer.Write(data);
        }

        public override void Serialize(MessageWriter writer)
        {
            base.Serialize(writer);

            writer.Write(MessageID ?? MessageId.Empty);

            // MotorStorm: Pacific Rift (21624), client reader 0x648f18/0x648b68 in EBOOT v1.03 and byte-identical
            // to the original service: varint length (strlen+1), URL, NUL, zero padding -> 151-byte message.
            if (writer.AppId == 21624)
                WriteMsprUrl(writer, URL, 128);
            else if (writer.MediusVersion >= 109)
            {
                // 1 byte length prefixed url
                if (URL == null)
                {
                    writer.Write((byte)0);
                }
                else
                {
                    writer.Write((byte)(URL.Length + 1));
                    writer.Write(URL, URL.Length);
                }
            }
            else
            {
                // fixed size url
                writer.Write(URL, 128);
            }
        }

        public override string ToString()
        {
            return base.ToString() + " " +
                $"MessageID: {MessageID} " +
                $"SVOURL: {URL}";
        }

    }
}
