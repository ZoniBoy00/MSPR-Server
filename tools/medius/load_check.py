"""Load check of the Medius side: N simulated players log in and ask for a Ranked game at the same time.

Every player goes the way the game does (see e2e_check.py): MAS session and NP ticket login, MLS lobby, the Ranked party request,
the referral to the MMS and the assigned game. The check says how many got a game, in which worlds, and how long it took.

  .\\scripts\\Start-MSPRServer.ps1 -TestMode -NoDashboard
  python -X utf8 tools\\medius\\load_check.py <the PC's LAN address> [-n 12] [--timeout 60]

The tickets (Load01 ... Load60) are made, signed with the test key, by make_test_ticket.mjs (test mode only, see README.md).
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import statistics
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import e2e_check as e2e  # noqa: E402

_local = threading.local()


def _capture(*args, **_kwargs):
    """e2e_check prints every step: keep the lines of each player instead, to read the world out of them."""
    _local.lines.append(" ".join(str(a) for a in args))


e2e.print = _capture   # the module's own name `print` now goes here (builtins are untouched)
e2e.mt.print = _capture   # the test client prints every message it sends and receives


def player(ip: str, name: str, ticket: bytes, results: dict, barrier: threading.Barrier) -> None:
    _local.lines = []
    res = {"name": name, "ok": False, "world": None, "seconds": None, "error": None}
    results[name] = res
    try:
        t0 = time.time()
        login = e2e.mas_login(ip, 10075, ticket)
        if not login:
            res["error"] = "ticket login failed: " + " | ".join(l.strip() for l in _local.lines[-5:])
            return
        mls_ip, mls_port, session_key, access = login
        barrier.wait(timeout=60)                      # everybody asks for a game at the same moment
        t1 = time.time()
        c = e2e.mt.handshake(mls_ip, mls_port, session_key=session_key, access_token=access)
        ok = e2e.ranked_matchmaking(c, session_key)
        res["seconds"] = round(time.time() - t1, 2)
        res["login_seconds"] = round(t1 - t0, 2)
        m = [re.search(r"world=(\d+)", ln) for ln in _local.lines]
        worlds = [int(x.group(1)) for x in m if x]
        res["world"] = worlds[-1] if worlds else None
        res["ok"] = bool(ok) and res["world"] is not None
        if not res["ok"]:
            res["error"] = next((ln.strip() for ln in reversed(_local.lines) if "!!" in ln), "no game assigned")
    except Exception as ex:  # a failed player is a result, not a crash of the check
        res["error"] = "%s: %s" % (type(ex).__name__, ex)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("host", help="the address of the stack (MAS answers on :10075)")
    ap.add_argument("-n", type=int, default=12, help="number of players (default 12)")
    ap.add_argument("--timeout", type=float, default=60, help="seconds to wait for all players")
    ap.add_argument("--start", type=int, default=1, help="number of the first player name (Load01 = 1): take the next names on a second run, Horizon keeps a client that has just gone for a while")
    a = ap.parse_args()

    tickets_file = HERE / "test_tickets.json"
    if not tickets_file.exists():
        print("no test tickets: run  node tools/medius/make_test_ticket.mjs  (the stack must run in test mode)")
        return 2
    tickets = {k: base64.b64decode(v) for k, v in json.loads(tickets_file.read_text()).items()}
    names = sorted(tickets)[a.start - 1:a.start - 1 + max(1, a.n)]
    if len(names) < a.n:
        print("not enough test tickets for --start %d -n %d" % (a.start, a.n))
        return 2

    results: dict = {}
    barrier = threading.Barrier(len(names))
    threads = [threading.Thread(target=player, args=(a.host, n, tickets[n], results, barrier), daemon=True) for n in names]
    t0 = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join(max(0.1, a.timeout - (time.time() - t0)))
    total = time.time() - t0

    done = [r for r in results.values()]
    good = [r for r in done if r["ok"]]
    worlds: dict = {}
    for r in good:
        worlds.setdefault(r["world"], []).append(r["name"])
    print("players: %d, got a game: %d, failed: %d, no answer: %d (%.1f s in all)"
          % (len(names), len(good), len(done) - len(good), len(names) - len(done), total))
    if good:
        secs = [r["seconds"] for r in good]
        print("matchmaking time: median %.2f s, slowest %.2f s" % (statistics.median(secs), max(secs)))
    for w, who in sorted(worlds.items()):
        print("  world %s: %d players (%s)" % (w, len(who), ", ".join(sorted(who))))
    for r in done:
        if not r["ok"]:
            print("  !! %s: %s" % (r["name"], r["error"]))
    ok = len(good) == len(names)
    print("RESULT: %s" % ("OK" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
