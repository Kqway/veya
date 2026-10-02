#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# != 1 || -z "${RESTORE_PGSERVICE:-}" || ! "$RESTORE_PGSERVICE" =~ ^[A-Za-z0-9_-]+$ || "$1" != /* || ! -f "$1" ]]; then
  printf '%s\n' 'Restore requires RESTORE_PGSERVICE and an absolute archive path.' >&2
  exit 1
fi
# Explicit destination overrides inherited source settings. It must be a separate,
# operator-created empty database, with web/workers stopped until verification.
export PGSERVICE="$RESTORE_PGSERVICE" PGCONNECT_TIMEOUT=5
unset PGDATABASE
restore_errors="$(mktemp)"
trap 'rm -f "$restore_errors"' EXIT
if ! restore_objects="$(psql --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')" 2>"$restore_errors")" || [[ "$restore_objects" != 0 ]]; then
  printf '%s\n' 'Restore refused: destination must be reachable and empty.' >&2
  exit 1
fi
if ! pg_restore --single-transaction --exit-on-error --no-owner --no-privileges --dbname="service=$RESTORE_PGSERVICE" "$1" 2>"$restore_errors"; then
  printf '%s\n' 'Restore failed and rolled back. Check archive, service configuration and database permissions.' >&2
  exit 1
fi
printf '%s\n' 'Restore completed. Verify release migration checksums and application recovery before promotion.'
