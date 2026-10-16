# horizon: Medius and DME (C#)

The Medius servers (MUIS, MAS, MLS, MPS, MMS) and the DME race servers for MotorStorm: Pacific Rift. This is a reduced copy of **PSMultiServer** (PSHome MultiServer): only the projects that Horizon needs to build are kept, so the other servers of the upstream project (Quazal, Blaze, SVO, MultiSocks and so on) are not here. The upstream licence is in [LICENSE](LICENSE); the libraries inside carry their own licences.

## Layout

| Path | Contents |
|---|---|
| `Servers/Horizon/` | The Horizon executable. |
| `Servers/Horizon/SERVER/Medius/Mspr/` | MSPR code: the Ranked/Casual matchmaker (`MsprMatchmaker.cs`), the `0x5E`/`0x60` messages (`MsprMessages.cs`), matchmade capacity rules, and the live state snapshot used by the status site. |
| `Servers/Horizon/SERVER/Medius/` | Medius servers. MSPR changes are in MUIS, MAS, MLS, MPS and MMS. |
| `Servers/Horizon/MUM/` | Game, channel and player management, including the game list and its filters. |
| `Servers/Horizon/DME/` | The DME message router (world, UDP per player). |
| `Servers/Horizon.Tests/` | Small tests for the MSPR capacity and visibility rules. |
| `AuxiliaryServices/HorizonService/` | Medius message models (`RT.Models`), database access (`LIBRARY.Database`), pipeline. |
| `AuxiliaryServices/WebAPIService/`, `BackendServices/` | Libraries Horizon depends on. |

## Building

```powershell
cd horizon\Servers\Horizon
dotnet build Horizon.csproj -c Release --no-incremental
```

- The target is .NET 10 (the output folder is `bin/Release/net10.0`). `Horizon.dll` embeds its dependencies (Costura), so changes in a library project always need `--no-incremental`.
- The last build step runs `DepsFixer.ps1` through `cmd`. On Linux it fails; the DLL is already built by then and the error can be ignored.
- `scripts\INSTALL-MSPR.cmd -Rebuild` does this for you on Windows.

## Settings

| Variable | Effect |
|---|---|
| `HORIZON_LOG_LEVEL` | `quiet`, `normal` (default) or `full` (every decoded message). |
| `HORIZON_IO_THREADS` | I/O threads per pool (default 4). |
| `HORIZON_XI5_IGNORE_EXPIRY` | `1` accepts expired but genuine NP tickets (tests only). |
| `MSPR_LOCATION_NAME` | The text in the game's online menu, "Online (`<name>`)". Default `Europe`. |
| `MSPR_MM_MIN_PLAYERS` | Experimental: minimum players advertised for matchmade games. |
| `MSPR_DB_API` | Address of the TypeScript server's account API. |
