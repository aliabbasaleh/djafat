#!/bin/sh
# Nightly pg_dump of the DJAFAT database, and an archive of the photos (FEAT-022,
# SPEC-022-04 R5: /data/uploads, mounted read-only); keeps the last 14 days.
set -eu
while true; do
  now=$(date -u +%Y-%m-%dT%H%M)
  pg_dump -h postgres -U djafat -d djafat -Fc -f "/backups/djafat-$now.dump" \
    && echo "backup ok: djafat-$now.dump" || echo "backup FAILED at $now"
  if [ -d /data/uploads ]; then
    tar -czf "/backups/uploads-$now.tar.gz" -C /data uploads \
      && echo "files ok: uploads-$now.tar.gz" || echo "files backup FAILED at $now"
  else
    # Never silent: without the volume, the photos are not backed up at all.
    echo "files backup FAILED at $now: /data/uploads is not mounted"
  fi
  find /backups -name 'djafat-*.dump' -mtime +14 -delete
  find /backups -name 'uploads-*.tar.gz' -mtime +14 -delete
  sleep 86400
done
