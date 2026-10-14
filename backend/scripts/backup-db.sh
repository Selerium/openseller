#!/bin/sh
#
# Nightly postgres dump. Runs from cron inside the backend container (1am UTC daily,
# installed by backend/entrypoint.sh) and writes to /app/backups, which is bind-mounted
# to ./backups on the host — so "the backups folder" is just a directory next to the
# repo, no volume spelunking needed to find a dump.
#
# Manual run:  docker compose exec backend /app/scripts/backup-db.sh
#
# Retention is by age, not count: BACKUP_RETENTION_DAYS (default 14) worth of nightly
# dumps stay, older ones are deleted. Dumps are pg custom format (-Fc): compressed,
# and restorable table-by-table with pg_restore, unlike a plain SQL text dump.
#
# ⚠ OFFSITE: these files sit on the same disk as the database. If this machine dies,
# they die with it. Copy them elsewhere (object storage, another host) on your own
# schedule — this script only guarantees they exist HERE.
set -eu

OUT_DIR="${BACKUP_DIR:-/app/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] FATAL: DATABASE_URL is unset, nothing to dump" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
TMP="$OUT_DIR/.pg-$STAMP.dump.tmp"
FINAL="$OUT_DIR/pg-$STAMP.dump"

# Dump to a temp name and move into place only on success: a failed or half-written
# dump must never look like last night's good backup.
pg_dump -Fc --dbname="$DATABASE_URL" -f "$TMP"

# Prove the file restores before trusting it: list its table of contents. A corrupt or
# version-mismatched dump fails here, loudly, instead of at 3am during a real incident.
ENTRIES="$(pg_restore --list "$TMP" 2>/dev/null | wc -l)"
if [ "$ENTRIES" -lt 10 ]; then
  echo "[backup] FATAL: $TMP lists only $ENTRIES entries, refusing to keep it" >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$FINAL"
# Root owns the file (cron runs as root); world-readable so the operator can actually
# copy it offsite without sudo gymnastics. Custom format is compressed binary, not
# plaintext, but treat it as sensitive anyway — it IS the whole database.
chmod 644 "$FINAL"

# Prune by mtime. `.tmp` files are never pruned here: a leftover tmp means a failed
# run, and deleting the evidence of failure is worse than one stale file.
DELETED="$(find "$OUT_DIR" -maxdepth 1 -name 'pg-*.dump' -mtime +"$RETENTION_DAYS" -print -delete | wc -l)"
SIZE="$(du -h "$FINAL" | cut -f1)"
echo "[backup] wrote $FINAL ($SIZE, $ENTRIES entries), pruned $DELETED older than $RETENTION_DAYS days"
