#!/bin/sh
# Nightly pg_dump of the DJAFAT database; keeps the last 14 days.
set -eu
while true; do
  now=$(date -u +%Y-%m-%dT%H%M)
  pg_dump -h postgres -U djafat -d djafat -Fc -f "/backups/djafat-$now.dump" \
    && echo "backup ok: djafat-$now.dump" || echo "backup FAILED at $now"
  find /backups -name 'djafat-*.dump' -mtime +14 -delete
  sleep 86400
done
