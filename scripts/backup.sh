#!/usr/bin/env bash
set -euo pipefail
umask 077
# Credentials come from a protected libpq service/pass file, never command arguments.
if [[ $# != 1 || -z "${PGSERVICE:-}" || ! "$PGSERVICE" =~ ^[A-Za-z0-9_-]+$ || "$1" != /* || -e "$1" ]]; then
  printf '%s\n' 'Backup requires PGSERVICE and a new absolute archive path.' >&2
  exit 1
fi
backup_target="$1"
backup_tmp="$(mktemp "${backup_target}.partial.XXXXXX")"
backup_errors="$(mktemp)"
cleanup() { rm -f "$backup_tmp" "$backup_errors"; }
trap cleanup EXIT
export PGCONNECT_TIMEOUT=5
if ! pg_dump --format=custom --lock-wait-timeout=10s --file="$backup_tmp" 2>"$backup_errors"; then
  printf '%s\n' 'Backup failed. Check PostgreSQL service configuration, availability and permissions.' >&2
  exit 1
fi
if ! pg_restore --list "$backup_tmp" >/dev/null 2>"$backup_errors"; then
  printf '%s\n' 'Backup archive validation failed.' >&2
  exit 1
fi
# Atomic no-clobber publish; concurrent jobs cannot replace an existing archive.
if ! ln "$backup_tmp" "$backup_target" 2>"$backup_errors"; then
  printf '%s\n' 'Backup destination already exists or is unavailable.' >&2
  exit 1
fi
printf '%s\n' 'Backup completed and archive validated. Encrypt and transfer off-host before retention.'
