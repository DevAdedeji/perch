#!/usr/bin/env bash
#
# Nightly logical backup of the Perch database.
#
#   NEON_CONNECTION_STRING='postgres://…' ./scripts/backup.sh [output-dir]
#
# Produces backups/perch-YYYY-MM-DD-HHMMSS.dump plus a SHA-256 checksum and
# prunes anything older than RETENTION_DAYS. Verify a restore with the guarded
# scripts/restore-verify.sh helper before relying on a backup.
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
umask 077

: "${NEON_CONNECTION_STRING:?Set NEON_CONNECTION_STRING to the Neon postgres URL}"

OUT_DIR="${1:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
if ! [[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "[backup] RETENTION_DAYS must be a positive whole number" >&2
  exit 1
fi

for command_name in pg_dump pg_restore shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[backup] required command is missing: $command_name" >&2
    exit 1
  fi
done

STAMP="$(date -u +%Y-%m-%d-%H%M%S)"
FILE="$OUT_DIR/perch-$STAMP.dump"

mkdir -p "$OUT_DIR"
TMP_FILE="$(mktemp "$OUT_DIR/.perch-$STAMP.XXXXXX")"
TMP_CHECKSUM="$TMP_FILE.sha256"
cleanup() {
  rm -f "$TMP_FILE" "$TMP_CHECKSUM"
}
trap cleanup EXIT INT TERM

echo "[backup] dumping to $FILE"
pg_dump "$NEON_CONNECTION_STRING" \
  --format=custom --compress=6 \
  --no-owner --no-privileges \
  --file="$TMP_FILE"

BYTES=$(wc -c < "$TMP_FILE")
if [ "$BYTES" -lt 1024 ]; then
  echo "[backup] FAILED: dump is only ${BYTES} bytes" >&2
  exit 1
fi

pg_restore --list "$TMP_FILE" >/dev/null
mv "$TMP_FILE" "$FILE"
(cd "$OUT_DIR" && shasum -a 256 "$(basename "$FILE")") > "$TMP_CHECKSUM"
mv "$TMP_CHECKSUM" "$FILE.sha256"
trap - EXIT INT TERM

echo "[backup] done ($(du -h "$FILE" | cut -f1))"

while IFS= read -r old_backup; do
  rm -f "$old_backup" "$old_backup.sha256"
done < <(find "$OUT_DIR" -type f -name 'perch-*.dump' -mtime "+$RETENTION_DAYS" -print)
echo "[backup] pruned dumps older than $RETENTION_DAYS days"

# optional off-site copy (configure a remote first: rclone config)
# rclone copy "$FILE" r2:perch-backups/
