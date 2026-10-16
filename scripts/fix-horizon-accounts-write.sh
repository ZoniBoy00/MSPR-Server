#!/usr/bin/env bash
# Lets Horizon write static/mspr_accounts.json: it saves through "mspr_accounts.json.tmp" and a rename, which needs write
# access to the folder, not only to the file. Run as root on the server:
#   bash scripts/fix-horizon-accounts-write.sh <Horizon static folder>
# The folder is the "static" folder next to Horizon.dll. Optional settings (environment): HORIZON_UNIT (default mspr-horizon),
# HORIZON_USER (default mspr), MSPR_WEB_PORT (default 8080).
# It adds a systemd drop-in (the unit itself is not changed) and restarts Horizon only when nobody is online.
set -euo pipefail
unit="${HORIZON_UNIT:-mspr-horizon}"; user="${HORIZON_USER:-mspr}"; port="${MSPR_WEB_PORT:-8080}"
static="${1:-}"
[ -d "$static" ] || { echo "usage: $0 <Horizon static folder>   (not a folder: '$static')" >&2; exit 2; }
mkdir -p /etc/systemd/system/$unit.service.d
cat > /etc/systemd/system/$unit.service.d/accounts-write.conf <<DROPIN
[Service]
ReadWritePaths=$static
DROPIN
chown "$user:$user" "$static" "$static/mspr_accounts.json" 2>/dev/null || true
systemctl daemon-reload
players=$(curl -s -m4 http://127.0.0.1:$port/api/players || echo '?')
if [ "$players" = "[]" ]; then
  systemctl restart $unit && echo "restarted $unit"
else
  echo "players online ($players): the drop-in is in place, restart later with: systemctl restart $unit"
fi
