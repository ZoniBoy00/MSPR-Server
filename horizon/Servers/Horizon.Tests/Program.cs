using Horizon.SERVER.Medius.Mspr;

static void Check(bool condition, string label)
{
    if (!condition) throw new InvalidOperationException(label);
}

Check(MspMatchmadeCapacity.ResolveReportedMaxPlayers(true, 12, 1) == 12, "matchmade capacity must not shrink to a client's one-player report");
Check(MspMatchmadeCapacity.ResolveReportedMaxPlayers(true, 12, 12) == 12, "matchmade capacity must preserve its configured limit");
Check(MspMatchmadeCapacity.ResolveReportedMaxPlayers(false, 12, 1) == 1, "ordinary custom games must keep the reported limit");
Check(MspMatchmadeCapacity.ShouldListUnderfilledCustomGame(true, false, 1, 2), "an underfilled MSPR custom lobby must be visible");
Check(!MspMatchmadeCapacity.ShouldListUnderfilledCustomGame(true, true, 1, 6), "matchmade ranked games must retain their minimum-player gate");
Check(!MspMatchmadeCapacity.ShouldListUnderfilledCustomGame(false, false, 1, 2), "other games must retain their existing minimum-player gate");
Console.WriteLine("capacity and custom-game visibility checks passed");
