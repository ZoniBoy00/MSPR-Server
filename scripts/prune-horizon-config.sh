#!/usr/bin/env bash
# Switches off the parts of Horizon that MotorStorm: Pacific Rift does not use, in a Horizon `static` folder:
#   - the bandwidth probe (BWPS, UDP 50100)
#   - MAPS (profile server, TCP 10471 / UDP 10472) and the second MAS port 10475
# The game never talks to them in the captures of the original service. Fewer open ports, less to attack.
# Safe to run twice. Restart Horizon afterwards (when nobody is playing).
#
#   scripts/prune-horizon-config.sh <static folder>        e.g. /opt/MSPR/MSPR-Server/PSMultiServer/Servers/Horizon/bin/Release/net10.0/static
#
# The Windows start script (Start-MSPRServer.ps1) does the same on every start.
set -euo pipefail

dir="${1:-}"
[ -n "$dir" ] && [ -f "$dir/horizon.json" ] && [ -f "$dir/medius.json" ] || { echo "usage: $0 <Horizon static folder with horizon.json and medius.json>" >&2; exit 2; }
command -v node >/dev/null || { echo "node is needed (it is installed with the server)" >&2; exit 1; }

node - "$dir" <<'JS'
const fs = require("fs"), path = require("path");
const dir = process.argv[2];
function edit(file, fn) {
  const p = path.join(dir, file);
  const raw = fs.readFileSync(p, "utf8");
  const bom = raw.charCodeAt(0) === 0xfeff;
  const json = JSON.parse(bom ? raw.slice(1) : raw);
  const changes = fn(json);
  if (changes.length) {
    fs.copyFileSync(p, p + ".before-prune");
    fs.writeFileSync(p, (bom ? "﻿" : "") + JSON.stringify(json, null, 4));
  }
  console.log(`${file}: ${changes.length ? changes.join(", ") : "already as wanted"}`);
}
edit("horizon.json", (m) => {
  const c = [];
  if (m.bwps && m.bwps.enabled !== false) { m.bwps.enabled = false; c.push("bwps off"); }
  return c;
});
edit("medius.json", (m) => {
  const c = [];
  if (m.EnableMAPS !== false) { m.EnableMAPS = false; c.push("EnableMAPS off"); }
  if (JSON.stringify(m.MASPorts) !== "[10075]") { m.MASPorts = [10075]; c.push("MASPorts [10075]"); }
  return c;
});
JS
