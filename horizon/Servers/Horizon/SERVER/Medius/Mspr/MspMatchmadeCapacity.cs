namespace Horizon.SERVER.Medius.Mspr;

public static class MspMatchmadeCapacity
{
    public static int ResolveReportedMaxPlayers(bool isMatchmade, int currentMaxPlayers, int reportedMaxPlayers)
    {
        return isMatchmade ? currentMaxPlayers : reportedMaxPlayers;
    }

    public static bool ShouldListUnderfilledCustomGame(bool isMspGame, bool isMatchmadeGame, int playerCount, int minPlayers)
    {
        return isMspGame && !isMatchmadeGame && playerCount < minPlayers;
    }
}
