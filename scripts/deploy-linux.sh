#!/usr/bin/env bash
# Copies the TypeScript server from this checkout to the directory a service runs from, keeping what belongs to the
# installation: node_modules, data/ (the database and its backups) and the local config files.
#
#   scripts/deploy-linux.sh <target>          target = the directory the service runs from, e.g. /opt/mspr/server
#
# It does not restart anything. Afterwards: systemctl restart <your server unit>.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-}"
[ -n "$target" ] || { echo "usage: scripts/deploy-linux.sh <target-dir>   (the directory the service runs from)" >&2; exit 2; }
src="$repo/server"

[ -d "$src/src" ] || { echo "no server/src in $repo" >&2; exit 1; }
mkdir -p "$target/config"

# code, tests and the package files are replaced as a whole
for item in src test package.json package-lock.json tsconfig.json; do
  rm -rf "${target:?}/$item"
  cp -a "$src/$item" "$target/$item"
done

# the RPCS3 patch the status site offers for download
mkdir -p "$target/downloads"
cp -a "$repo/patches/rpcs3/imported_patch.yml" "$target/downloads/imported_patch.yml"

# config files are only added when missing, so local settings (ports, EULA text, bans) survive
for f in "$src"/config/*; do
  [ -e "$target/config/$(basename "$f")" ] || cp -a "$f" "$target/config/"
done

# dependencies: install only when the lockfile changed
if ! cmp -s "$src/package-lock.json" "$target/node_modules/.package-lock.deployed" 2>/dev/null; then
  if command -v npm >/dev/null 2>&1; then
    (cd "$target" && npm ci --no-fund --no-audit) && cp "$src/package-lock.json" "$target/node_modules/.package-lock.deployed"
  else
    echo "package-lock.json changed or node_modules is missing, but npm is not on PATH: run 'npm ci' in $target" >&2
  fi
fi

echo "Deployed $(git -C "$repo" rev-parse --short HEAD 2>/dev/null || echo "this checkout") to $target"
