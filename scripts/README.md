# scripts

| Script | Where | What |
|---|---|---|
| `INSTALL-MSPR.cmd`, `Install-MSPR.ps1` | Windows | Checks and installs what the server needs (.NET, Node.js), builds Horizon (`-Rebuild`), opens the firewall ports (`-Firewall`). |
| `START-MSPR.cmd`, `Start-MSPRServer.ps1` | Windows | Starts Horizon and the TypeScript server, points RPCS3's DNS at this PC and opens the status console. `-TestMode` is for the self-test in `tools/medius`. |
| `STOP-MSPR.cmd`, `Stop-MSPRServer.ps1` | Windows | Stops everything and points RPCS3's DNS back (`-RestoreDns`). |
| `run_horizon.cmd` | Windows | Runs the built Horizon in its own window. Called by `Start-MSPRServer.ps1`. |
| `Build-Package.ps1` | Windows | Builds a package (`dist\MSPR-Server`, plus a zip) that can be unzipped on another PC. |
| `deploy-linux.sh <target>` | Linux | Copies the TypeScript server from a checkout to the directory a service runs from; local config and data stay. |
| `collect-diagnostics.sh [minutes] [server-dir]` | Linux | Bundles the journals, the event journal, the request log and a UDP sample into one archive for a bug report. |
| `capture-ps3.sh [ps3-ip] [out-dir] [max-minutes]` | Linux, root | Records one test session with tcpdump (DNS, SVO, Medius, race ports), rotating, kept on the server. |
| `prune-horizon-config.sh <static folder>` | Linux | Switches off what the game does not use in a Horizon `static` folder (bandwidth probe, MAPS and the second MAS port). Safe to run twice; restart Horizon afterwards. |
| `fix-horizon-accounts-write.sh <static folder>` | Linux | Lets Horizon write its account backup (`static/mspr_accounts.json`) under `ProtectSystem=strict`. |

The Windows scripts work from a clone of the repository and from a package; the Linux scripts need a checkout. How they fit together: [getting started](../docs/guides/getting-started.md) (Windows) and [deployment](../docs/guides/deployment.md) (Linux).
