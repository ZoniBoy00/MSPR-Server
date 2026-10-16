"""Follow only the game's Medius/DME connections in Horizon.log.

Horizon's own DME keeps ~80 internal connections (CLIENT_HELLO version 110) that flood
the log. Game connections say CLIENT_HELLO version 113; this prints just those
conversations (decoded messages) plus warnings/errors and MSPR matchmaker lines.

Usage: python -X utf8 game_trace.py [Horizon.log] [--since HH:MM]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_LOG = HERE.parents[1] / "horizon/Servers/Horizon/bin/Release/net10.0/logs/Horizon.log"

CONN = re.compile(r"\[id: 0x[0-9a-f]+, \[::ffff:([\d.]+)\]:(\d+) => \[::ffff:[\d.]+\]:(\d+)\]")
INTERESTING = re.compile(r"MSPR|XI5|UNHANDLED|Exception|INVALID|FAIL|CRIT|ERROR|WARN.*\[(MLS|MAS|MMS|MUIS)\]")


def main():
    argv = sys.argv[1:]
    since = ""
    if "--since" in argv:
        i = argv.index("--since")
        since = argv[i + 1]
        del argv[i:i + 2]
    args = argv
    log = Path(args[0]) if args else DEFAULT_LOG
    game = set()      # (client ip, client port, server port)
    for raw in log.read_text(encoding="utf-8", errors="replace").splitlines():
        if since and raw[11:16] < since:
            continue
        m = CONN.search(raw)
        key = (m.group(1), m.group(2), m.group(3)) if m else None
        if key and "RT_MSG_CLIENT_HELLO Version: 113" in raw:
            game.add(key)
        if key in game:
            if "ECHO" in raw:
                continue
            line = CONN.sub(lambda mm: ":%s" % mm.group(3), raw)
        elif not key and INTERESTING.search(raw):
            line = raw
        else:
            continue
        line = re.sub(r"\t(INFO|WARN|FAIL|CRIT|DBUG)\t\[Horizon\]\t\[0\]\t", r" \1 ", line)
        line = re.sub(r"(rsakey|Key): [0-9A-F]{40,}|rsakey: \d{40,}", r"\1:<..>", line)
        line = line.replace("Horizon.RT.Models.", "").replace("Horizon.SERVER.Medius.Mspr.", "")
        print(line[11:600])


if __name__ == "__main__":
    main()
