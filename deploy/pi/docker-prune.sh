#!/bin/sh
# Weekly Docker cleanup so rebuilds don't slowly fill the SD card.
# - dangling images (old untagged layers left behind by each rebuild)
# - build cache unused for 7+ days, then whatever is still over KEEP_CACHE (recent cache is
#   kept so code-only rebuilds stay fast; one dependency rebuild of the agent alone adds GBs)
# Never touches running containers, tagged images, or volumes.
# Run from root's crontab; logs to /var/log/docker-prune.log.
set -u
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LOG=/var/log/docker-prune.log
KEEP_CACHE=2GB

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

before=$(df -h / | awk 'NR==2 {print $3 " used, " $4 " free"}')
img=$(docker image prune -f 2>&1 | tail -1)
old=$(docker builder prune -f --filter until=168h 2>&1 | tail -1)
over=$(docker builder prune -f --max-used-space "$KEEP_CACHE" 2>&1 | tail -1)  # Docker 29+ (was --keep-storage)
after=$(df -h / | awk 'NR==2 {print $3 " used, " $4 " free"}')

log "images: $img | old cache: $old | cache over $KEEP_CACHE: $over | disk before: $before | after: $after"
