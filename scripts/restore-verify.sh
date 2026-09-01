#!/usr/bin/env bash

set -euo pipefail

BACKUP_FILE="${1:-}"
: "${BACKUP_FILE:?Usage: RESTORE_TARGET_URL='postgresql://...' RESTORE_CONFIRM=verify-fresh-database ./scripts/restore-verify.sh backups/perch-....dump}"
: "${RESTORE_TARGET_URL:?Set RESTORE_TARGET_URL to a fresh disposable PostgreSQL database}"

if [ "${RESTORE_CONFIRM:-}" != "verify-fresh-database" ]; then
  echo "[restore] refusing to continue: set RESTORE_CONFIRM=verify-fresh-database" >&2
  exit 1
fi
if [ -n "${NEON_CONNECTION_STRING:-}" ] && [ "$RESTORE_TARGET_URL" = "$NEON_CONNECTION_STRING" ]; then
  echo "[restore] refusing to restore into NEON_CONNECTION_STRING; use a fresh branch/database" >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore] backup file does not exist: $BACKUP_FILE" >&2
  exit 1
fi

for command_name in pg_restore psql shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[restore] required command is missing: $command_name" >&2
    exit 1
  fi
done

if [ -f "$BACKUP_FILE.sha256" ]; then
  (cd "$(dirname "$BACKUP_FILE")" && shasum -a 256 -c "$(basename "$BACKUP_FILE").sha256")
else
  echo "[restore] warning: no checksum file found; validating the archive structure only" >&2
fi
pg_restore --list "$BACKUP_FILE" >/dev/null

TARGET_TABLES=$(psql "$RESTORE_TARGET_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -c "select count(*) from pg_catalog.pg_tables where schemaname not in ('pg_catalog', 'information_schema');")
if [ "$TARGET_TABLES" != "0" ]; then
  echo "[restore] refusing to overwrite a database containing $TARGET_TABLES table(s)" >&2
  exit 1
fi

echo "[restore] restoring into a confirmed empty disposable database"
pg_restore "$BACKUP_FILE" \
  --dbname="$RESTORE_TARGET_URL" \
  --exit-on-error --single-transaction \
  --no-owner --no-privileges

psql "$RESTORE_TARGET_URL" -X -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
do $$
begin
  if to_regclass('public.users') is null
    or to_regclass('public.workspaces') is null
    or to_regclass('public.conversations') is null
    or to_regclass('drizzle.__drizzle_migrations') is null then
    raise exception 'restore is missing one or more required Perch tables';
  end if;
end
$$;

select
  (select count(*) from drizzle.__drizzle_migrations) as migrations,
  (select count(*) from users) as users,
  (select count(*) from workspaces) as workspaces,
  (select count(*) from conversations) as conversations;
SQL

echo "[restore] verification complete; discard this test database after review"
