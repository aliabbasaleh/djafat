#!/bin/sh
# Health check with alerts for the server (audit finding OPS-02: deployed, but nothing
# noticed when it broke). Run it from cron every 5 minutes, from infra/deploy:
#
#   */5 * * * * cd /home/ubuntu/djafat/infra/deploy && ./healthcheck.sh >> backups/.healthcheck.log 2>&1
#
# It checks the public sites and the API, the containers, the disk, the age of the last
# backup and the result of the last restore check. It alerts ALERT_NTFY_URL (in .env.prod:
# an ntfy.sh topic, e.g. https://ntfy.sh/djafat-ops-<long random suffix>, read with the free
# ntfy phone app) only when the state changes (a problem appears, or everything is back),
# plus a reminder every 6 hours while a problem lasts. Without ALERT_NTFY_URL it only logs.
#
# A dead server cannot report itself: also watch https://api.<DOMAIN>/v1/health from
# outside (e.g. a free UptimeRobot monitor), see README.md "Surveillance".
set -u
cd "$(dirname "$0")"

COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"
STATE=backups/.health-state
REMIND_MINUTES=360
DISK_LIMIT_PERCENT=85
BACKUP_MAX_AGE_MINUTES=1560 # 26 h: the backup runs every 24 h
RESTORE_CHECK_MAX_AGE_DAYS=8

# Only the two settings this script needs, read without sourcing the whole file (it holds
# secrets and values a shell would misread).
env_value() { grep -m1 "^$1=" .env.prod 2>/dev/null | cut -d= -f2-; }
DOMAIN="${DOMAIN:-$(env_value DOMAIN)}"
ALERT_NTFY_URL="${ALERT_NTFY_URL:-$(env_value ALERT_NTFY_URL)}"
CHECK_URLS="${CHECK_URLS:-https://$DOMAIN https://api.$DOMAIN/v1/health https://api.$DOMAIN/v1/ready https://admin.$DOMAIN https://resto.$DOMAIN https://livreur.$DOMAIN}"

problems=""
problem() { problems="${problems}- $1
"; }

# 1. The sites and the API answer.
for url in $CHECK_URLS; do
  curl -fsS -o /dev/null --max-time 15 "$url" 2>/dev/null || problem "$url ne répond pas"
done

# 2. Every container runs, and none reports itself unhealthy.
ps_out=$($COMPOSE ps --all --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)
if [ -z "$ps_out" ]; then
  problem "docker compose ps n'a rien renvoyé"
else
  bad=$(printf '%s\n' "$ps_out" | awk '$2 != "running" || $3 == "unhealthy" { print $1 " (" $2 ($3 ? ", " $3 : "") ")" }')
  [ -z "$bad" ] || problem "conteneurs en panne : $(echo $bad)"
fi

# 3. The disk is not full.
used=$(df -P / | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
[ "${used:-0}" -lt "$DISK_LIMIT_PERCENT" ] || problem "disque plein à ${used} %"

# 4. A backup was made in the last 26 hours.
[ -n "$(find backups -name 'djafat-*.dump' -mmin -$BACKUP_MAX_AGE_MINUTES 2>/dev/null | head -1)" ] \
  || problem "aucune sauvegarde de moins de 26 h dans backups/"

# 5. The last restore check (restore-check.sh) passed, and is recent.
if [ ! -f backups/.restore-check ]; then
  problem "jamais de test de restauration (lancer ./restore-check.sh)"
elif [ -n "$(find backups/.restore-check -mtime +$RESTORE_CHECK_MAX_AGE_DAYS 2>/dev/null)" ]; then
  problem "dernier test de restauration de plus de $RESTORE_CHECK_MAX_AGE_DAYS jours"
elif ! grep -q '^OK ' backups/.restore-check; then
  problem "le dernier test de restauration a échoué : $(cut -d' ' -f3- backups/.restore-check)"
fi

alert() { # title (ASCII: it travels as an HTTP header), message
  if [ -z "$ALERT_NTFY_URL" ]; then
    echo "(no ALERT_NTFY_URL) $1: $2"
    return 0
  fi
  curl -fsS --max-time 15 -H "Title: $1" -H "Tags: rotating_light" -d "$2" "$ALERT_NTFY_URL" >/dev/null \
    || echo "alert could not be sent to ALERT_NTFY_URL"
}

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
previous=$(cat "$STATE" 2>/dev/null || echo OK)
if [ -z "$problems" ]; then
  echo "$now OK"
  if [ "$previous" != "OK" ]; then
    alert "DJAFAT: retabli" "Tout fonctionne de nouveau ($DOMAIN, $now)."
  fi
  echo OK > "$STATE"
  exit 0
fi

# Compared without the trailing newline, the way $(cat "$STATE") reads it back.
summary=$(printf '%s' "$problems")
echo "$now PROBLEM"
echo "$summary"
if [ "$previous" != "$summary" ] || [ -n "$(find "$STATE" -mmin +$REMIND_MINUTES 2>/dev/null)" ]; then
  alert "DJAFAT: probleme" "$(printf 'Serveur %s, %s :\n%s' "$DOMAIN" "$now" "$summary")"
  echo "$summary" > "$STATE" # rewritten: the 6-hour reminder counts from now
fi
exit 1
