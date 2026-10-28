#!/usr/bin/env bash
# Nightly backup: run ON the VM (cron line below). Archives the JSON data
# volume and, when ARYA_BACKUP_DATABASE_URL is set in deploy/.env, a
# pg_dump of the arya schema only (never the host project's own tables). Keeps the
# newest KEEP files of each kind. Copy BACKUP_DIR off the VM if you can;
# a backup on the same disk does not survive losing the VM.
#
#   17 3 * * *  /path/to/arya/assistant/deploy/backup.sh >> /var/log/arya-backup.log 2>&1
#
# Restore: ./restore.sh <data-archive.tar.gz>
set -euo pipefail
cd "$(dirname "$0")"
BACKUP_DIR="${BACKUP_DIR:-$HOME/arya-backups}"
KEEP="${KEEP:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

# --- JSON data volume (receipts, quest, sessions, frames, ledger) ---
docker compose exec -T api tar czf - -C /app data > "$BACKUP_DIR/arya-data-$STAMP.tar.gz.part"
mv "$BACKUP_DIR/arya-data-$STAMP.tar.gz.part" "$BACKUP_DIR/arya-data-$STAMP.tar.gz"
echo "data volume -> $BACKUP_DIR/arya-data-$STAMP.tar.gz"

# --- arya schema in Postgres (only once the Supabase move has a URL) ---
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi
if [ -n "${ARYA_BACKUP_DATABASE_URL:-}" ]; then
  docker run --rm postgres:16-alpine pg_dump --schema=arya --no-owner \
    "$ARYA_BACKUP_DATABASE_URL" | gzip > "$BACKUP_DIR/arya-pg-$STAMP.sql.gz.part"
  mv "$BACKUP_DIR/arya-pg-$STAMP.sql.gz.part" "$BACKUP_DIR/arya-pg-$STAMP.sql.gz"
  echo "arya schema -> $BACKUP_DIR/arya-pg-$STAMP.sql.gz"
else
  echo "ARYA_BACKUP_DATABASE_URL not set: skipping the Postgres dump"
fi

# --- retention ---
for kind in arya-data arya-pg; do
  ls -1t "$BACKUP_DIR"/"$kind"-*.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
done
