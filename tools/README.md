# tools

Python helpers. They are not needed to run the server.

| Folder | Purpose |
|---|---|
| `medius/` | A Medius test client and the end-to-end self-test. `e2e_check.py` runs against a server started in test mode: DNS, MUIS, MAS, MLS, Ranked matchmaking (MLS, MMS, back to the lobby), stats to the database, SVO, race result on the leaderboard. `scert_crypto.py` implements the SCE-RT crypto, `game_trace.py` follows a Horizon log. |

```powershell
python -X utf8 tools\medius\e2e_check.py        # needs the server started with scripts\Start-MSPRServer.ps1 -TestMode
```
