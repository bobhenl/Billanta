#!/bin/sh
# Daily on the VPS (crontab of `ubuntu`, see deploy/README.md): dump the
# database, drop old dumps, and clear Docker leftovers. The VPS also runs
# VoxelRank and TicketSmith, so unused images and build cache go after 3
# days instead of a week.
set -eu
cd /opt/billanta
mkdir -p backups
umask 077

# BACKUP_AGE_RECIPIENT (an age public key) and BACKUP_REMOTE (an rclone
# remote:path) come from .env. With a recipient set, the dump is encrypted
# before it touches the disk and only the owner's offline private key can open
# it, so neither this server, the code nor the Drive account is enough to read
# a backup. Without one it falls back to the old plain dump, kept on this disk
# only.
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }
recipient=$(env_value BACKUP_AGE_RECIPIENT)
remote=$(env_value BACKUP_REMOTE)

stamp=$(date +%Y%m%d-%H%M)
dump() {
  docker compose -f deploy/docker-compose.prod.yml --env-file .env exec -T postgres \
    sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'
}
if [ -n "$recipient" ]; then
  # pipefail is not in POSIX sh: a failed pg_dump is caught by the size check instead.
  dump | age -r "$recipient" > "backups/.billanta-$stamp.dump.age.part"
  [ "$(wc -c < "backups/.billanta-$stamp.dump.age.part")" -gt 1024 ] || { echo "$(date -Is) FAIL empty dump" >&2; exit 1; }
  mv "backups/.billanta-$stamp.dump.age.part" "backups/billanta-$stamp.dump.age"
  if [ -n "$remote" ]; then
    rclone copy "backups/billanta-$stamp.dump.age" "$remote"
    rclone delete "$remote" --min-age "${REMOTE_KEEP_DAYS:-60}d" --include 'billanta-*.dump.age'
  fi
else
  echo "$(date -Is) WARNING BACKUP_AGE_RECIPIENT not set, writing a plain dump" >&2
  dump > "backups/.billanta-$stamp.dump.part"
  mv "backups/.billanta-$stamp.dump.part" "backups/billanta-$stamp.dump"
fi

find backups -maxdepth 1 \( -name 'billanta-*.dump' -o -name 'billanta-*.dump.age' \) -mtime +"${KEEP_DAYS:-14}" -delete
find backups -maxdepth 1 -name '.billanta-*.part' -mmin +60 -delete
find logs -maxdepth 1 -name '*.log' -mtime +30 -delete 2>/dev/null || true

docker image prune -af --filter until=72h >/dev/null
docker builder prune -af --filter until=72h >/dev/null
docker container prune -f --filter until=72h >/dev/null
echo "$(date -Is) ok $(du -sh backups | cut -f1)"
