# tools/medius

A test client that speaks the game's own protocol (SCE-RT / Medius) to the running stack, and the check built on it.

| File | What it is |
|---|---|
| `e2e_check.py` | Follows the path of the game: DNS, MUIS (universe information with the SVO address), MAS (session and NP ticket login), MLS (lobby), Ranked matchmaking through the MMS up to the assigned game, the account stats in the database, and the SVO requests (index, login, EULA, announcement, leaderboard, a finished race). Prints every step and ends with `RESULT: OK` or `FAILED`. |
| `medius_testclient.py`, `scert_crypto.py`, `medius_ids.py` | The client: the SCERT handshake and crypto, framing and message ids. |
| `load_check.py` | Load check of the Medius side: N simulated players (default 12) log in and ask for a Ranked game at the same moment; it says how many got a game, in which worlds and how long it took. Each player has its own ticket (`Load01` ... `Load60`, signed with the test key). `--start K` takes the names from the K-th on: Horizon keeps a client that has just gone for a while, so a second run needs fresh names. |
| `game_trace.py` | Prints a recorded game session. |
| `make_test_ticket.mjs` | Makes the test key and the ticket for the check (see below). |

## Running the check

Start the stack **in test mode** and run the check against the LAN address of the PC:

```powershell
.\scripts\Start-MSPRServer.ps1 -TestMode -NoDashboard
python -X utf8 tools\medius\e2e_check.py <the PC's LAN address>
.\scripts\Stop-MSPRServer.ps1
```

The check needs Python 3 and, for the test ticket, Node.js (both are on the development PC).

## Load check

```powershell
python -X utf8 tools\medius\load_check.py <the PC's LAN address> -n 12
```

Twelve players usually get one Ranked game of twelve and 24 players two games of twelve (checked on the development PC). A game is closed as soon as it is formed, so when the requests arrive a few milliseconds apart a straggler can get a game of its own (seen once: 11 and 1). The times it prints include the fixed waits of the test client, so they only show that nothing stalls; the server's own timings are in the Horizon log. It does not drive the race itself (the DME).

## The test key

The real NP tickets of the captures expire after 15 minutes, and the ticket kept for the tests was edited, so its RPCN signature no longer matches. `make_test_ticket.mjs` therefore makes a **test key** (a secp224k1 key pair like RPCN's) and signs the same ticket with it:

- `test_rpcn_private.pem`, `test_rpcn_public.pem` and `test_ticket.bin` are generated on the spot and are not in the repository (`.gitignore`). `Start-MSPRServer.ps1 -TestMode` runs the script before it starts Horizon.
- Horizon trusts the test key **only in test mode**: `run_horizon.cmd test` sets `HORIZON_XI5_IGNORE_EXPIRY=1` and `HORIZON_XI5_TEST_PUBKEY` (the path of the public key), and `XI5Ticket.cs` reads the key only when both are set. In a normal run the variables are ignored, and tickets must still carry RPCN's or Sony's signature. Never set them on a server that players use.
