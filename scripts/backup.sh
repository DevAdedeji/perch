#!/usr/bin/env bash
#
# Nightly logical backup of the Perch database.
#
#   NEON_CONNECTION_STRING='postgres://…' ./scripts/backup.sh [output-dir]
#
# Produces backups/perch-YYYY-MM-DD-HHMM.sql.gz and prunes anything older than
# RETENTION_DAYS. Restore with:
#
#   gunzip -c perch-….sql.gz | psql "$NEON_CONNECTION_STRING"
#
# Neon's own point-in-time restore covers short-window mistakes; this script is
# the off-provider copy for the day Neon itself is the problem. Schedule it from
# any machine with pg_dump (laptop cron, a $0 VM, Railway cron):
#
#   0 3 * * * cd ~/perch && NEON_CONNECTION_STRING=… ./scripts/backup.sh >> backup.log 2>&1
#
# To ship copies off-machine, uncomment the rclone line at the bottom (works
# with Cloudflare R2, Backblaze B2, S3 — all have free tiers).

set -euo pipefail

: "${NEON_CONNECTION_STRING:?Set NEON_CONNECTION_STRING to the Neon postgres URL}"

OUT_DIR="${1:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y-%m-%d-%H%M)"
FILE="$OUT_DIR/perch-$STAMP.sql.gz"

mkdir -p "$OUT_DIR"

echo "[backup] dumping to $FILE"
pg_dump "$NEON_CONNECTION_STRING" \
  --no-owner --no-privileges \
  | gzip > "$FILE"

# a dump that small is a failed dump — don't let it silently replace real ones
BYTES=$(wc -c < "$FILE")
if [ "$BYTES" -lt 1024 ]; then
  echo "[backup] FAILED: dump is only ${BYTES} bytes" >&2
  rm -f "$FILE"
  exit 1
fi

echo "[backup] done ($(du -h "$FILE" | cut -f1))"

find "$OUT_DIR" -name 'perch-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
echo "[backup] pruned dumps older than $RETENTION_DAYS days"

# optional off-site copy (configure a remote first: rclone config)
# rclone copy "$FILE" r2:perch-backups/
