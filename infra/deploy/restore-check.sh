#!/bin/sh
# Proves the newest backup can be restored (audit finding OPS-02): restores it into a
# SCRATCH database next to the live one, checks it, then drops it. The live database is
# never written to. Run it on the server, from infra/deploy, e.g. every week from cron:
#
#   ./restore-check.sh                         # the newest backups/djafat-*.dump
#   ./restore-check.sh backups/djafat-2026-11-18T0300.dump
#
# Exit code 0 = restorable; anything else = this backup cannot be trusted. Writes the
# result to backups/.restore-check (read by healthcheck.sh).
set -eu
cd "$(dirname "$0")"

COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"
SCRATCH=djafat_restore_check
LIVE_DB="${LIVE_DB:-djafat}" # only read, to compare migrations
DUMP="${1:-$(ls -1t backups/djafat-*.dump 2>/dev/null | head -1)}"
RESULT=backups/.restore-check

fail() {
  echo "RESTORE CHECK FAILED: $1"
  printf 'FAIL %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" > "$RESULT"
  $COMPOSE exec -T postgres dropdb -U djafat --if-exists "$SCRATCH" >/dev/null 2>&1 || true
  exit 1
}

[ -n "$DUMP" ] && [ -f "$DUMP" ] || fail "no backup file found"
echo "restoring $DUMP into the scratch database $SCRATCH"

sql() { $COMPOSE exec -T postgres psql -U djafat -d "$1" -tAc "$2"; }

$COMPOSE exec -T postgres dropdb -U djafat --if-exists "$SCRATCH"
$COMPOSE exec -T postgres createdb -U djafat "$SCRATCH"
$COMPOSE exec -T postgres pg_restore -U djafat -d "$SCRATCH" --exit-on-error < "$DUMP" \
  || fail "pg_restore failed on $DUMP"

migrations=$(sql "$SCRATCH" "select count(*) from _prisma_migrations where finished_at is not null")
live_migrations=$(sql "$LIVE_DB" "select count(*) from _prisma_migrations where finished_at is not null")
users=$(sql "$SCRATCH" "select count(*) from users")
unbalanced=$(sql "$SCRATCH" "select count(*) from (select 1 from ledger_entries group by entry_group, currency having sum(case when direction = 'debit' then amount_minor else -amount_minor end) <> 0) u")
postgis=$(sql "$SCRATCH" "select postgis_lib_version()")

echo "migrations: $migrations (live: $live_migrations) · users: $users · unbalanced ledger groups: $unbalanced · PostGIS $postgis"
[ "$migrations" -gt 0 ] || fail "no migration recorded in the restored database"
# A deploy after the backup may add migrations to the live database, never remove some.
[ "$migrations" -le "$live_migrations" ] || fail "the restored database has more migrations than the live one"
[ "$users" -gt 0 ] || fail "the restored database has no users"
[ "$unbalanced" -eq 0 ] || fail "$unbalanced unbalanced ledger groups in the restored database"

# FEAT-022 (SPEC-022-04 R5, SC05): every photo the restored database refers to is in the
# photos archive of the same night (backup.sh writes djafat-<stamp>.dump, uploads-<stamp>.tar.gz).
STAMP="$(basename "$DUMP" .dump)"
STAMP="${STAMP#djafat-}"
FILES="backups/uploads-$STAMP.tar.gz"
KEYS=""
if [ "$(sql "$SCRATCH" "select to_regclass('public.courier_applications') is not null")" = "t" ]; then
  KEYS=$(sql "$SCRATCH" "select k from (
      select unnest(array[face_photo_key, id_card_photo_key, driving_licence_photo_key,
        vehicle_registration_photo_key, insurance_photo_key, plate_photo_key]) as k from courier_applications
      union all
      select unnest(array[registry_photo_key, owner_id_photo_key]) from restaurant_applications
    ) refs where k is not null")
fi
if [ -n "$KEYS" ]; then
  [ -f "$FILES" ] || fail "the database refers to photos but $FILES does not exist"
  LISTING="$(tar -tzf "$FILES" 2>/dev/null)" || fail "the photos archive $FILES is unreadable"
  missing=0
  for key in $KEYS; do
    printf '%s\n' "$LISTING" | grep -qx "uploads/$key" || missing=$((missing + 1))
  done
  echo "photos archive: $(basename "$FILES") · $(printf '%s\n' "$KEYS" | wc -l | tr -d ' ') photo(s) referenced, $missing missing"
  [ "$missing" -eq 0 ] || fail "$missing photo(s) referenced by the database are missing from $FILES"
elif [ -f "$FILES" ]; then
  tar -tzf "$FILES" >/dev/null 2>&1 || fail "the photos archive $FILES is unreadable"
  echo "photos archive: $(basename "$FILES") · no photo referenced yet"
fi

$COMPOSE exec -T postgres dropdb -U djafat "$SCRATCH"
printf 'OK %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$DUMP")" > "$RESULT"
echo "restore check OK: $DUMP is restorable"
