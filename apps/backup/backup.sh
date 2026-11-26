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
# One or more age public keys (`age1...`, separated by spaces or commas). The
# matching private key stays offline with the founder, so the VPS, the image
# and the Drive account together still cannot read a backup. Falls back to
# BACKUP_AGE_RECIPIENT, the single key deploy/maintenance.sh already reads,
# so one line in .env covers both backup paths.
BACKUP_AGE_RECIPIENTS="${BACKUP_AGE_RECIPIENTS:-${BACKUP_AGE_RECIPIENT:-}}"

log() {
  printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
}

encryption_enabled() {
  [ -n "${BACKUP_AGE_RECIPIENTS//[ ,]/}" ]
}

# Fills AGE_ARGS with `-r <key>` pairs. Fails on a malformed key: the
# operator asked for encryption, so a typo must not quietly turn into a
# plaintext upload.
AGE_ARGS=()
parse_recipients() {
  local key
  AGE_ARGS=()
  for key in ${BACKUP_AGE_RECIPIENTS//,/ }; do
    if [[ ! "$key" =~ ^age1[02-9ac-hj-np-z]{58}$ ]]; then
      log "FAILURE: BACKUP_AGE_RECIPIENTS contains a value that is not an age public key (expected age1... from age-keygen) -- refusing to back up unencrypted"
      return 1
    fi
    AGE_ARGS+=(-r "$key")
  done
}

run_backup() {
  local ts file path part size encrypted=0 mode="plaintext"
  ts="$(date -u +%Y%m%d-%H%M%S)"
  file="faktur-backup-${ts}.sql.gz"

  if encryption_enabled; then
    parse_recipients || return 1
    encrypted=1
    file="${file}.age"
    mode="age, $(( ${#AGE_ARGS[@]} / 2 )) recipient(s)"
  else
    log "WARNING: BACKUP_AGE_RECIPIENTS is not set -- this backup is uploaded UNENCRYPTED. Put an age public key in .env, see apps/backup/README.md"
  fi

  path="${BACKUP_LOCAL_DIR}/${file}"
  # Written under a .part name and renamed when complete, so a run that dies
  # mid-dump never leaves a truncated file that looks like a finished backup.
  part="${BACKUP_LOCAL_DIR}/.${file}.part"

  mkdir -p "$BACKUP_LOCAL_DIR"
  log "starting backup run -> ${file} (${mode})"

  # Streamed end to end, so with encryption on no plaintext dump ever touches
  # the disk. pipefail (set above) makes a pg_dump failure fail the pipeline.
  if [ "$encrypted" = 1 ]; then
    if ! pg_dump --no-owner --no-privileges --dbname="$DATABASE_URL" | gzip | age "${AGE_ARGS[@]}" > "$part"; then
      log "FAILURE: pg_dump/gzip/age pipeline failed for ${file}"
      rm -f "$part"
      return 1
    fi
  elif ! pg_dump --no-owner --no-privileges --dbname="$DATABASE_URL" | gzip > "$part"; then
    log "FAILURE: pg_dump/gzip pipeline failed for ${file}"
    rm -f "$part"
    return 1
  fi

  if [ ! -s "$part" ]; then
    log "FAILURE: dump file ${file} is empty -- refusing to upload"
    rm -f "$part"
    return 1
  fi

  # The gzip stream inside an .age file can't be tested without the private
  # key, which is never here; the age header at least proves age wrote it.
  if [ "$encrypted" = 1 ]; then
    if [ "$(head -n 1 "$part")" != "age-encryption.org/v1" ]; then
      log "FAILURE: dump file ${file} has no age header -- refusing to upload"
      rm -f "$part"
      return 1
    fi
  elif ! gzip -t "$part" 2>/dev/null; then
    log "FAILURE: dump file ${file} failed gzip integrity check -- refusing to upload"
    rm -f "$part"
    return 1
  fi

  mv "$part" "$path"
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

# Both the plaintext (.sql.gz) and the encrypted (.sql.gz.age) names are
# pruned, so old plaintext copies from before encryption was switched on
# still age out.
prune_local() {
  local pruned=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    log "pruned local backup: ${f}"
    pruned=$((pruned + 1))
  done < <(find "$BACKUP_LOCAL_DIR" -maxdepth 1 -type f \( -name 'faktur-backup-*.sql.gz' -o -name 'faktur-backup-*.sql.gz.age' \) -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete 2>/dev/null || true)
  find "$BACKUP_LOCAL_DIR" -maxdepth 1 -type f -name '.faktur-backup-*.part' -mmin +60 -delete 2>/dev/null || true
  log "local prune complete (${pruned} file(s) older than ${BACKUP_RETENTION_DAYS}d removed)"
}

prune_remote() {
  if rclone delete "$BACKUP_RCLONE_REMOTE" --config "$RCLONE_CONFIG" \
      --min-age "${BACKUP_RETENTION_DAYS}d" \
      --include 'faktur-backup-*.sql.gz' \
      --include 'faktur-backup-*.sql.gz.age'; then
    log "remote prune complete (removed backups older than ${BACKUP_RETENTION_DAYS}d from ${BACKUP_RCLONE_REMOTE})"
  else
    log "WARNING: remote prune step failed -- old backups on ${BACKUP_RCLONE_REMOTE} may not have been removed, check manually"
  fi
}

log "backup service starting (interval=${BACKUP_INTERVAL_HOURS}h retention=${BACKUP_RETENTION_DAYS}d remote=${BACKUP_RCLONE_REMOTE} encryption=$(encryption_enabled && echo age || echo OFF))"

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
