# Security

What the server exposes, what it trusts and what was hardened. Reviewed (code review of `server/`, the Horizon parts that MSPR changed, and the live Linux server).

## What is exposed

| Port | Who can reach it | Notes |
|---|---|---|
| UDP 53 (DNS) | everybody | Answers the game's own names with this server's address, forwards only the names in `dns.forwardNames` (PlayStation Network) to the upstream resolver and refuses the rest, so it is not an open resolver. Open-resolver scanners do probe it; they get `SERVFAIL`. The firewall limits each source to 10 queries a second (burst 50). |
| TCP 10060 (SVO) | everybody | Plain HTTP, the game's own protocol. No password exists: the player is identified by the NP ticket and a session cookie. |
| TCP 8080/8081 (status site, API) | everybody if the port is open | Read-only. Restricted parts need the admin token (see [api](api.md#privacy-and-access)). |
| TCP 10071-10079, UDP 50000-50099 | everybody | Medius and DME, the game's binary protocol. |
| TCP 10076, 61920, 8443, 3001 | nobody | Horizon's own HTTP endpoints listen on all interfaces; the firewall (IPv4 `INPUT DROP` and the IPv6 chain) keeps them closed. `/GetMspr/` additionally answers only the loopback address. |

## What the server trusts, and what it checks

- **The player's identity.** Medius login: Horizon checks the NP ticket signature (RPCN or PSN key) and the expiry. SVO login: the same signature check is **logged only** (`ticket` in the `login` event; `svo.requireSignedTickets` would refuse a wrong one). Until it is switched on, anybody who can reach port 10060 can log in to SVO under any online id by posting a ticket with that name; this only reaches the leaderboards, not the online game. Turn it on after a real PS3 login shows `valid: true`.
- **Session cookie.** SVO sets `AuthKeyTime` at the login and reads the account from it. The plain `AcctID`/`AcctName` cookies of the original service captures are **not** honoured (they are only used by the replay tests, `MSPR_TRUST_ACCT_COOKIE=1`); in earlier versions any request could name any account.
- **Race results.** The race runs on the players' machines, so a result is only plausibility-checked ([anti-cheat](../guides/getting-started.md)). It is off on the live server (`antiCheat.enabled=false`). Whatever the setting, `gameMode`, `track` and `vehicle` of a result must be numbers; anything else is dropped (they reach XML attributes and SQL filters).

## Limits against abuse

| Where | Limit |
|---|---|
| SVO request body | 512 kB (a ghost is at most 256 kB); more is answered `413` and the connection is cut |
| SVO login | 60 per minute and address (`429`) |
| SVO sessions | at most 5 000 kept, older than 24 h dropped |
| Online ids | letters, digits, `-` and `_`, 16 characters; a PSN id cannot be given an `@PSN` suffix |
| Web API | 300 requests a minute and address; `friends` lists at most 50 ids |
| DNS | queries only (a packet with the response bit is ignored); an upstream answer counts only from the upstream with the same id |
| Horizon API (`/horizon/*`) | loopback only; bodies over 1 MB are cut; a ban needs `kind` `account` or `ip` and a value |

SQL is parameterised everywhere; the only text put into SQL are fixed column lists and generated placeholders. Files are written only under `server/data` with names built from digits.

## Deployment hardening

- Both services run as the user `mspr` with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, kernel protection and a short `ReadWritePaths` list ([deployment](../guides/deployment.md)).
- `server/config/mspr.json` holds the admin token: owner `root`, group `mspr`, mode `640` (a `600` once stopped the service because the user `mspr` could not read it).
- .NET 6 is out of support; Horizon runs on .NET 10 (see [findings](../research/findings.md#6-horizon-on-net-10-live)).

## Known gaps

- Plain HTTP and the game's own protocols: nothing here is encrypted that the game does not encrypt.
- SVO ticket check is log-only (above).
- The in-race data is relayed by the DME and cannot be checked; speed hacks are invisible to any server.
- A reverse proxy in front of the status site must set `X-Forwarded-For`, or every viewer looks local and counts as an admin.
