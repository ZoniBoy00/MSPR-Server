using System;
using System.Collections.Generic;
using Horizon.RT.Common;

namespace Horizon.RT.Models
{
    public enum HorizonLogLevel { Quiet, Normal, Full }

    /// <summary>
    /// Per-message logging for Release builds (MotorStorm: Pacific Rift server).
    ///   HORIZON_LOG_LEVEL=quiet   no per-message lines (connections, MSPR events and errors still logged)
    ///   HORIZON_LOG_LEVEL=normal  every Medius request/response, without keep-alive noise (default)
    ///   HORIZON_LOG_LEVEL=full    every decoded SCE-RT/Medius message incl. echoes and periodic reports
    /// HORIZON_VERBOSE=1 (old switch) = full.
    /// </summary>
    public static class VerboseLog
    {
        public static readonly HorizonLogLevel Level = Parse();

        /// <summary>true = full logging (old HORIZON_VERBOSE behaviour).</summary>
        public static bool Enabled => Level == HorizonLogLevel.Full;

        // sent every few seconds per connection: useful only when debugging the transport itself
        private static readonly HashSet<RT_MSG_TYPE> NoiseIds = new()
        {
            RT_MSG_TYPE.RT_MSG_SERVER_ECHO, RT_MSG_TYPE.RT_MSG_CLIENT_ECHO,
        };
        private static readonly HashSet<string> NoiseMedius = new(StringComparer.Ordinal)
        {
            "MediusPlayerReport", "MediusWorldReport", "MediusServerReport", "MediusServerWorldReportOnMe",
        };

        public static bool ShouldLog(BaseScertMessage message)
        {
            switch (Level)
            {
                case HorizonLogLevel.Full: return true;
                case HorizonLogLevel.Quiet: return false;
            }
            if (NoiseIds.Contains(message.Id))
                return false;
            BaseMediusMessage? inner = message switch
            {
                RT_MSG_CLIENT_APP_TOSERVER c => c.Message,
                RT_MSG_SERVER_APP s => s.Message,
                _ => null,
            };
            return inner == null || !NoiseMedius.Contains(inner.GetType().Name);
        }

        private static HorizonLogLevel Parse()
        {
            string? level = Environment.GetEnvironmentVariable("HORIZON_LOG_LEVEL");
            if (!string.IsNullOrWhiteSpace(level) && Enum.TryParse(level.Trim(), true, out HorizonLogLevel parsed))
                return parsed;
            return Environment.GetEnvironmentVariable("HORIZON_VERBOSE") == "1" ? HorizonLogLevel.Full : HorizonLogLevel.Normal;
        }
    }
}
