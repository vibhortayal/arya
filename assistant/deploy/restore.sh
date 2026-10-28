#!/usr/bin/env bash
# Restore the JSON data volume from a backup.sh archive. Stops the api,
# replaces /app/data, starts it again. The Postgres dump is restored by
# hand with psql, on purpose: it should never run by accident.
set -euo pipefail
[ $# -eq 1 ] && [ -f "$1" ] || { echo "usage: $0 <arya-data-*.tar.gz>"; exit 2; }
cd "$(dirname "$0")"
docker compose stop api
docker compose run --rm -T --no-deps --entrypoint sh api -c \
  'rm -rf /app/data/* /app/data/.[!.]* 2>/dev/null; tar xzf - -C /app' < "$1"
docker compose start api
echo "restored from $1"
