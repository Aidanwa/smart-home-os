#!/bin/sh
# Nightly backup of everything on this Pi that can't be rebuilt from GitHub:
#   - smart-home-os postgres (pg_dump custom format)
#   - smart-home-os .env (JWT_SECRET_KEY decrypts stored secrets!)
#   - Zigbee2MQTT data dir (network key, paired devices) minus logs
#   - /etc/mosquitto (broker config + password file)
#   - Pi-hole Teleporter export
# Writes ~$OWNER/backups/smarthome-YYYY-MM-DD.tar.gz (mode 600), keeps 14 days.
# OWNER comes from /etc/smarthome-os.conf (see smarthome-os.conf.example).
# Run from root's crontab; logs to /var/log/smarthome-backup.log.
set -u
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077

CONF=/etc/smarthome-os.conf
[ -r "$CONF" ] && . "$CONF"
OWNER=${OWNER:-}
DEST=/home/$OWNER/backups
REPO=/home/$OWNER/smart-home-os
Z2M_DATA=/home/zigbee2mqtt/zigbee2mqtt/data
KEEP_DAYS=14
LOG=/var/log/smarthome-backup.log
STAMP=$(date +%F)
OUT="$DEST/smarthome-$STAMP.tar.gz"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
if [ -z "$OWNER" ]; then log "ERROR: set OWNER in $CONF"; exit 1; fi
failed=""

STAGE=$(mktemp -d /tmp/smarthome-backup.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$DEST" "$STAGE/smarthome"
chown "$OWNER:$OWNER" "$DEST"; chmod 700 "$DEST"

# 1. Postgres (critical). Dump, then validate the archive is readable.
if docker exec home_postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc home_os' > "$STAGE/smarthome/home_os.dump" \
   && docker exec -i home_postgres pg_restore --list < "$STAGE/smarthome/home_os.dump" > /dev/null; then
    :
else
    log "ERROR: postgres dump failed"; failed="$failed postgres"
fi

# 2. .env (critical)
cp "$REPO/.env" "$STAGE/smarthome/.env" || { log "ERROR: .env copy failed"; failed="$failed env"; }

# 3. Zigbee2MQTT data without logs (critical)
mkdir -p "$STAGE/zigbee2mqtt"
if ! tar -C "$Z2M_DATA" --exclude=./log -cf - . | tar -C "$STAGE/zigbee2mqtt" -xf -; then
    log "ERROR: zigbee2mqtt copy failed"; failed="$failed z2m"
fi

# 4. Mosquitto
cp -a /etc/mosquitto "$STAGE/mosquitto" || { log "ERROR: mosquitto copy failed"; failed="$failed mosquitto"; }

# 5. Pi-hole Teleporter (writes a zip into the cwd and prints its name)
mkdir -p "$STAGE/pihole"
if ! (cd "$STAGE/pihole" && pihole-FTL --teleporter > /dev/null 2>&1) || [ -z "$(ls "$STAGE/pihole")" ]; then
    log "ERROR: pihole teleporter failed"; failed="$failed pihole"
fi

# Bundle (even if a step failed, keep whatever we got)
if tar -C "$STAGE" -czf "$OUT.tmp" . && mv "$OUT.tmp" "$OUT"; then
    chown "$OWNER:$OWNER" "$OUT"; chmod 600 "$OUT"
else
    rm -f "$OUT.tmp"; log "ERROR: could not write $OUT"; exit 1
fi

# Retention
find "$DEST" -name 'smarthome-*.tar.gz' -mtime +$((KEEP_DAYS - 1)) -delete

size=$(du -h "$OUT" | cut -f1)
count=$(ls "$DEST"/smarthome-*.tar.gz | wc -l)
if [ -n "$failed" ]; then
    log "PARTIAL: $OUT ($size), failed:$failed; $count bundles kept"
    exit 1
fi
log "ok: $OUT ($size); $count bundles kept"
