#!/usr/bin/env bash
# Collects what is needed to find out why a game or a race went wrong, into one archive (Linux server).
#
#   scripts/collect-diagnostics.sh [minutes] [server-dir]
#
#   minutes     how far back to look (default 30)
#   server-dir  the directory the TypeScript server runs from (default: the server/ folder of this checkout)
#
# The archive holds the journals of both services, the server's event journal and SVO request log, the live game
# snapshot, a 15 second count of the UDP packets per player on the race ports and the open ports. It contains
# player names and IP addresses, so send it only to the person who is looking into the problem. It does NOT contain
# config/mspr.json (the admin token is in there).
set -uo pipefail
minutes="${1:-30}"
dir="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/server}"
out="/tmp/mspr-diag-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"

since="-${minutes}min"
journalctl -u mspr-horizon --since "$since" --no-pager > "$out/horizon.journal.txt" 2>&1
journalctl -u mspr-server-ts --since "$since" --no-pager > "$out/server-ts.journal.txt" 2>&1
[ -f "$dir/data/diagnostics.log" ] && tail -n 2000 "$dir/data/diagnostics.log" > "$out/diagnostics.log"
[ -f "$dir/data/svo_requests.log" ] && tail -n 2000 "$dir/data/svo_requests.log" > "$out/svo_requests.log"
curl -s --max-time 3 http://127.0.0.1:61920/GetMspr/ > "$out/getmspr.json" 2>&1
{ date; echo; systemctl is-active mspr-horizon mspr-server-ts; echo; uptime; free -m; df -h /; } > "$out/system.txt" 2>&1
ss -tulnp 2>/dev/null | grep -E ":(53|8080|8081|1007[0-9]|10060|500[0-9][0-9]|50100) " > "$out/ports.txt"

if command -v tcpdump >/dev/null 2>&1; then
  echo "UDP packets on 50000-50100 in 15 s, by direction, source and destination (a player who sends nothing is stuck or cut off):" > "$out/udp-sample.txt"
  timeout 15 tcpdump -nn -i any -q "udp and portrange 50000-50100" 2>/dev/null \
    | sed -E 's/^[0-9:.]+ +//' | awk '{print $1, $3, $4, $5}' | sed 's/:$//' | sort | uniq -c | sort -rn >> "$out/udp-sample.txt"
else
  echo "tcpdump is not installed: apt install tcpdump" > "$out/udp-sample.txt"
fi

tar -C /tmp -czf "$out.tar.gz" "$(basename "$out")" && rm -rf "$out"
echo "$out.tar.gz"
