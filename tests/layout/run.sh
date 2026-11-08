#!/usr/bin/env bash
# Phone/desktop layout check against the live dashboard.
# usage: tests/layout/run.sh [out-dir]
#   SMARTHOME_HOST  dashboard host (required, e.g. <pi-host>.<tailnet>.ts.net)
#   SMARTHOME_SSH   ssh alias for the Pi (default: smarthome-pi)
#   CHROME          Chrome/Chromium binary (default: the usual Windows install path)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${SMARTHOME_HOST:?set SMARTHOME_HOST to the dashboard host}"
ssh_host="${SMARTHOME_SSH:-smarthome-pi}"
out="${1:-$(mktemp -d)}"
mkdir -p "$out"

tok="$(mktemp)"
trap 'rm -f "$tok"' EXIT
chmod 600 "$tok"
ssh "$ssh_host" "docker exec -i -w /app/services/gateway home_gateway uv run --no-sync python -" \
  < "$here/mint-token.py" > "$tok"
[ -s "$tok" ] || { echo "token mint failed" >&2; exit 1; }

node "$here/check-layout.mjs" "$tok" "$out"
