#!/usr/bin/env bash
# apps/backup/backup.sh — nightly logical backup -> Google Drive (via rclone).
#
# See docs/CZ-SK-Invoicing-SaaS-Blueprint.md §8 (Security & GDPR):
#   "Nightly logical (pg_dump) ... backups, pushed off-VPS ... 30-day
#   retention, quarterly restore drills." This script implements the
#   pg_dump + off-VPS-push + retention part; the restore drill is a manual
#   procedure documented in apps/backup/README.md (an untested backup is
#   not a backup).
#
# Retention design note (both local + remote pruning avoid hand-rolled date
# arithmetic on purpose, since Alpine's BusyBox `date` does not support the
# GNU `-d "N days ago"` style relative parsing this would otherwise need):
#   - local pruning uses `find -mtime +N`, which compares file mtime against
#     "N*24h ago" using the filesystem's own clock -- no date string parsing
#     at all, so it behaves identically under BusyBox or GNU findutils.
#   - remote pruning uses rclone's own `--min-age Nd` flag, which rclone
#     parses internally (documented, tested by the rclone project) -- again
#     no shell date math involved.
set -euo pipefail

BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:?BACKUP_RCLONE_REMOTE must be set, e.g. gdrive:faktur-backups -- see apps/backup/README.md}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/backups}"
# Matches XDG_CONFIG_HOME=/config set in apps/backup/Dockerfile, which is
# also where rclone's own official image expects rclone.conf -- see root
# docker-compose.yml's `backup` service volume mount.
RCLONE_CONFIG="${RCLONE_CONFIG:-/config/rclone/rclone.conf}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set (postgres://user:pass@host:port/db)}"

log() {
  printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
}

run_backup() {
  local ts file path size
  ts="$(date -u +%Y%m%d-%H%M%S)"
  file="faktur-backup-${ts}.sql.gz"
  path="${BACKUP_LOCAL_DIR}/${file}"

  mkdir -p "$BACKUP_LOCAL_DIR"
  log "starting backup run -> ${file}"

  if ! pg_dump --no-owner --no-privileges --dbname="$DATABASE_URL" | gzip > "$path"; then
    log "FAILURE: pg_dump/gzip pipeline failed for ${file}"
    rm -f "$path"
    return 1
  fi

  if [ ! -s "$path" ]; then
    log "FAILURE: dump file ${file} is empty -- refusing to upload"
    rm -f "$path"
    return 1
  fi

  if ! gzip -t "$path" 2>/dev/null; then
    log "FAILURE: dump file ${file} failed gzip integrity check -- refusing to upload"
    return 1
  fi

  size="$(du -h "$path" | cut -f1)"
  log "pg_dump OK: ${file} (${size})"

  if [ ! -f "$RCLONE_CONFIG" ]; then
    log "FAILURE: no rclone config found at ${RCLONE_CONFIG} -- run 'rclone config' locally and mount the result, see apps/backup/README.md"
    return 1
  fi

  if ! rclone copy "$path" "$BACKUP_RCLONE_REMOTE" --config "$RCLONE_CONFIG"; then
    log "FAILURE: rclone upload of ${file} to ${BACKUP_RCLONE_REMOTE} failed"
    return 1
  fi

  log "SUCCESS: ${file} uploaded to ${BACKUP_RCLONE_REMOTE}"

  prune_local
  prune_remote
  return 0
}

prune_local() {
  local pruned=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    log "pruned local backup: ${f}"
    pruned=$((pruned + 1))
  done < <(find "$BACKUP_LOCAL_DIR" -maxdepth 1 -type f -name 'faktur-backup-*.sql.gz' -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete 2>/dev/null || true)
  log "local prune complete (${pruned} file(s) older than ${BACKUP_RETENTION_DAYS}d removed)"
}

prune_remote() {
  if rclone delete "$BACKUP_RCLONE_REMOTE" --config "$RCLONE_CONFIG" \
      --min-age "${BACKUP_RETENTION_DAYS}d" \
      --include 'faktur-backup-*.sql.gz'; then
    log "remote prune complete (removed backups older than ${BACKUP_RETENTION_DAYS}d from ${BACKUP_RCLONE_REMOTE})"
  else
    log "WARNING: remote prune step failed -- old backups on ${BACKUP_RCLONE_REMOTE} may not have been removed, check manually"
  fi
}

log "backup service starting (interval=${BACKUP_INTERVAL_HOURS}h retention=${BACKUP_RETENTION_DAYS}d remote=${BACKUP_RCLONE_REMOTE})"

# `docker compose run backup --once` (or `./backup.sh --once` inside the
# container) triggers a single immediate run for manual testing -- see
# apps/backup/README.md.
if [ "${1:-}" = "--once" ]; then
  if run_backup; then
    exit 0
  else
    exit 1
  fi
fi

while true; do
  run_backup || log "backup run failed -- will retry after the next interval"
  sleep "$(( BACKUP_INTERVAL_HOURS * 3600 ))"
done
