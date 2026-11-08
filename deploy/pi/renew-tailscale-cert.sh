#!/bin/sh
# Renews the Tailscale (Let's Encrypt) cert for the smart-home-os gateway.
# Restarts the gateway only when the cert actually changed (uvicorn reads it at startup).
# Run from root's crontab; logs to /var/log/tailscale-cert-renew.log.
set -u
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

HOST=zigbee-hub.tail1752d3.ts.net
DIR=/home/adams/smart-home-os/certs
CRT="$DIR/$HOST.crt"
KEY="$DIR/$HOST.key"
LOG=/var/log/tailscale-cert-renew.log

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

mkdir -p "$DIR"
before=$(sha256sum "$CRT" 2>/dev/null | cut -d' ' -f1)

if ! out=$(tailscale cert --cert-file "$CRT" --key-file "$KEY" "$HOST" 2>&1); then
    log "ERROR: tailscale cert failed: $out"
    exit 1
fi

after=$(sha256sum "$CRT" | cut -d' ' -f1)
expiry=$(openssl x509 -enddate -noout -in "$CRT" | cut -d= -f2)

if [ "$before" = "$after" ]; then
    log "unchanged (expires $expiry)"
    exit 0
fi

log "cert updated (expires $expiry)"
if docker ps --format '{{.Names}}' | grep -qx home_gateway; then
    if docker restart home_gateway >/dev/null 2>&1; then
        log "restarted home_gateway"
    else
        log "ERROR: failed to restart home_gateway"
        exit 1
    fi
else
    log "home_gateway not running; nothing to restart"
fi
