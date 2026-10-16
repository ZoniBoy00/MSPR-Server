# Deploying to a Linux server

Notes from running the server on a Hetzner VPS (Linux, systemd). Replace `<server-ip>` with your own address.

## Layout

The server is a checkout of this repository. Two systemd services run from it:

| Service | What it runs | Port(s) |
|---|---|---|
| `mspr-server` | `server/` (TypeScript): DNS, SVO, status site and JSON API, SQLite database | UDP 53, TCP 10060 (SVO), TCP 8080 (web; `web.port` in `server/config/mspr.json`) |
| `mspr-horizon` | Horizon (C#): Medius MUIS, MAS, MLS, MPS, MMS and DME | TCP 10071, 10073, 10075, 10077, 10078, 10079; UDP 50000-50099 (DME) |

The repository layout is described in the [README](../../README.md). Run the services from a checkout of the repository, or from a copy of `server/` plus a built Horizon, whichever fits your setup. Keep the database (`server/data`), the local config (`server/config/mspr.json`) and the Horizon build output out of version control; they are in `.gitignore`.

## Firewall and ports

This is the one port list. The Windows guide, the architecture page and the Windows installer (`Install-MSPR.ps1 -Firewall`) use the same ports.

**Open to the players** (inbound, in the VPS firewall and the provider's firewall; on a home network, forward them on the router):

| Protocol | Ports | Service | Why |
|---|---|---|---|
| UDP | 53 | DNS | the game resolves its server names through it. The DNS service is UDP only: TCP 53 is not needed. |
| TCP | 10071 | MUIS | universe information |
| TCP | 10075 | MAS | login |
| TCP | 10078 | MLS | lobby |
| TCP | 10079 | MMS | matchmaking |
| TCP | 10077 | MPS | the game connects to it (seen in the captures of the original service), so it must be reachable |
| TCP | 10073 | DME | race server, connection setup |
| UDP | **50000-50099** | DME | race data. **Each player gets its own port** (50000, 50001, ...), so opening only 50000 lets just the first player in and every later player fails to join. |
| TCP | 10060 | SVO | leaderboards, EULA, announcement, race results |
| TCP | 8080 (live server: 8081) | status site | only if the site should be public; the port is `web.port` in `server/config/mspr.json` |

**Keep closed** (Horizon's own HTTP endpoints for the TypeScript server; they listen on all interfaces, so the firewall is what protects them): TCP 10076, 61920, 8443 and 3001. UDP 10070 (the original NAT service) is not used by this server.

Checking from outside: `Test-NetConnection <server-ip> -Port 10071` on Windows, `nc -vz <server-ip> 10071` on Linux for the TCP ports; UDP cannot be probed that way, test it with a second player on another network.

## Building Horizon on the server

```bash
cd horizon/Servers/Horizon
DOTNET_ROOT=/opt/dotnet /opt/dotnet/dotnet build -c Release --no-incremental   # needs the .NET 10 SDK
/opt/dotnet/dotnet build-server shutdown                                          # the build server keeps ~300 MB; stop leftover MSBuild processes too
```

The last build step (`DepsFixer.ps1`) calls `cmd` and fails on Linux. The DLL is built before that, so the error can be ignored. Copy `Horizon.dll` and `Horizon.pdb` from `bin/Release/net10.0` to the directory the service runs from and keep the `Horizon.deps.json` that is already there, then `systemctl restart mspr-horizon`. Changes in a library project need `--no-incremental` because the libraries are embedded into `Horizon.dll`.

Restarting Horizon drops every connected player with a "connection lost" message, so restart it only when nobody is in a game. `GET /api/players` shows who is online.

## Settings through the environment

| Variable | Service | Effect |
|---|---|---|
| `HORIZON_LOG_LEVEL` | mspr-horizon | `quiet`, `normal` (default) or `full`. `full` logs every decoded message and is meant for short debugging sessions. |
| `MSPR_LOCATION_NAME` | mspr-horizon | The text in the game's online menu, "Online (`<name>`)". Default `Europe`. |
| `MSPR_DB_API` | mspr-horizon | Where Horizon reaches the `server` database API. |

Set a value with a drop-in file, for example `/etc/systemd/system/mspr-horizon.service.d/env.conf` containing `[Service]` and `Environment=MSPR_LOCATION_NAME=Finland`, then `systemctl daemon-reload && systemctl restart mspr-horizon`.

## Backups and restore

The TypeScript server writes a daily copy of the database to `server/data/backups/` and keeps 14. To restore, stop `mspr-server`, copy the chosen backup over `server/data/mspr.sqlite`, delete `mspr.sqlite-wal` and `mspr.sqlite-shm`, and start it again. Copy the backups off the machine too if the data matters.

## SSH rate limit

If the firewall rate-limits new SSH connections (for example 4 per minute), many short `ssh` calls in a row time out. Batch commands into a single connection.

## Updating a running server

Keep one checkout of the repository on the server (for example `/opt/MSPR`) and let the services run from a copy that holds the installation's own files (`node_modules`, `data/`, `config/mspr.json`):

```bash
cd /opt/MSPR && git pull
scripts/deploy-linux.sh /opt/mspr/server                   # code, tests and package files; local config and data stay
systemctl restart mspr-server                               # your unit's name
```

`deploy-linux.sh` replaces `src/`, `test/` and the package files, adds config files that are missing but never overwrites existing ones, and runs `npm ci` only when the lockfile changed. For Horizon, build in `horizon/Servers/Horizon` (see above), copy `Horizon.dll` and `Horizon.pdb` to the directory the unit runs from and restart `mspr-horizon` when nobody is in a game.

Running the TypeScript server straight from the checkout (`WorkingDirectory=/opt/MSPR/server`, with `npm ci` there) also works; then no copy is needed, but `data/` and `config/mspr.json` live inside the checkout and `git pull` must not touch them (they are ignored by git).

### Moving a checkout from the old layout

Before the folders were reorganised the files lived under `source/server-ts`, `source/PSMultiServer` and a generated `MSPR-Server/` copy. A plain `git pull` removes the tracked files there, so migrate like this (the unit files need no change):

1. Check `GET /api/players`; nobody should be in a game.
2. Back up: `tar` the old `server-ts` directory without `node_modules` (it contains `data/`, including `mspr.sqlite-wal` and `-shm`), and copy its `config/` directory.
3. `git fetch && git reset --hard origin/main` in the checkout.
4. Recreate the runtime directory: copy `server/{src,test,package.json,package-lock.json,tsconfig.json}` into it and put the saved `config/` back (or run `scripts/deploy-linux.sh` and then restore your `mspr.json`).
5. Restart `mspr-server` and check `GET /api/health`.

## When Horizon hangs

Symptom: players stay on a search or a menu and Horizon logs nothing new. Look for a thread that spins: `top -H -p $(systemctl show -p MainPID --value mspr-horizon)` shows a `.NET TP` thread at 100 %. Its managed stack:

```bash
dotnet tool install --tool-path /root/dtools dotnet-stack            # once, DOTNET_ROOT=/opt/dotnet DOTNET_ROLL_FORWARD=Major
T=$(ls -d /tmp/systemd-private-*-mspr-horizon.service-*/tmp | head -1); ln -sfn "$T" /tmp/hz
TMPDIR=/tmp/hz /root/dtools/dotnet-stack report -p <pid>             # the symlink keeps the socket path under 108 characters
```

This is how the empty-`DefaultChannelGroup` loop in `MMS.Tick` was found ([findings](../research/findings.md#6-horizon-on-net-10-live)).

## Files Horizon writes

`static/mspr_accounts.json` (the offline copy of the accounts) is written through `mspr_accounts.json.tmp` and a rename, so the service needs write access to the **folder**: the unit's `ReadWritePaths` must name `.../static` (`scripts/fix-horizon-accounts-write.sh <static folder>` adds a drop-in) and the folder must belong to the user `mspr` (`chown mspr:mspr .../static`). Otherwise Horizon logs `could not save static/mspr_accounts.json`. The accounts themselves live in the database, so nothing is lost meanwhile.

## Notes from the live server

* `config/mspr.json` is `root:mspr 640`; the deploy script never overwrites it. `antiCheat.enabled` is `false` there, `dns.forwardNames` holds the PlayStation Network domains, `web.adminToken` is set.
* The firewall is an `INPUT` policy `DROP` with a `MSPR-GAME` chain (and `MSPR-V6` for IPv6) that opens only the ports above; UDP 53 is limited to 10 queries a second per source. A real PS3 asks for ~250 names in a burst; the limiter did not drop any.
* Many short SSH connections lock you out for a minute (4 per minute, and every attempt restarts the window): send a whole job in one `ssh` call and never retry in a loop.
* `systemctl restart mspr-server-ts` takes about six seconds and drops DNS and SVO; Horizon's restart drops every player. Check `GET /api/players` first.
