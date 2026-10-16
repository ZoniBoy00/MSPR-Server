#!/usr/bin/env bash
# Records the traffic of one test session on the server with tcpdump: the game's DNS and SVO requests (plain HTTP),
# Medius and the race servers. For finding out what a real PS3 sends and receives (see docs/guides/diagnostics.md).
#
#   scripts/capture-ps3.sh [ps3-ip] [out-dir] [max-minutes]
#
# ps3-ip       only this client (recommended; without it every client is recorded)
# out-dir      default /var/lib/mspr-captures (created, mode 700)
# max-minutes  default 120; stop earlier with Ctrl-C
#
# The files hold the players' IP addresses and unencrypted game traffic: keep them on the server, do not publish them.
# At most 6 files of 100 MB are kept (the oldest is overwritten).
set -euo pipefail

command -v tcpdump >/dev/null || { echo "tcpdump is not installed (apt install tcpdump)" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (tcpdump needs it)" >&2; exit 1; }

client="${1:-}"
out="${2:-/var/lib/mspr-captures}"
minutes="${3:-120}"
[[ "$client" =~ ^[0-9]+(\.[0-9]+){3}$ || -z "$client" ]] || { echo "ps3-ip must be an IPv4 address" >&2; exit 2; }
[[ "$minutes" =~ ^[0-9]+$ ]] || { echo "max-minutes must be a number" >&2; exit 2; }

ports="(udp port 53 or tcp port 10060 or tcp portrange 10070-10079 or udp portrange 50000-50100 or tcp portrange 50000-50100)"
filter="$ports"
[ -z "$client" ] || filter="$ports and host $client"

umask 077
mkdir -p "$out"
chmod 700 "$out"
file="$out/ps3-$(date +%Y%m%d-%H%M%S).pcap"
echo "Recording to $file (rotating, 6 x 100 MB), filter: $filter"
echo "Stops after $minutes minutes or with Ctrl-C."
timeout "${minutes}m" tcpdump -i any -n -s 0 -C 100 -W 6 -w "$file" "$filter" || [ $? -eq 124 ]
echo "Done. Files in $out:"
ls -la "$out"
