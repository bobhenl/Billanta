#!/bin/sh
# Daily on the VPS (crontab of `ubuntu`, see deploy/README.md): dump the
# database, drop old dumps, and clear Docker leftovers. The VPS also runs
# VoxelRank and TicketSmith, so unused images and build cache go after 3
# days instead of a week.
set -eu
cd /opt/billanta
mkdir -p backups
umask 077

stamp=$(date +%Y%m%d-%H%M)
docker compose -f deploy/docker-compose.prod.yml --env-file .env exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/.billanta-$stamp.dump.part"
mv "backups/.billanta-$stamp.dump.part" "backups/billanta-$stamp.dump"

find backups -maxdepth 1 -name 'billanta-*.dump' -mtime +"${KEEP_DAYS:-14}" -delete
find backups -maxdepth 1 -name '.billanta-*.part' -mmin +60 -delete
find logs -maxdepth 1 -name '*.log' -mtime +30 -delete 2>/dev/null || true

docker image prune -af --filter until=72h >/dev/null
docker builder prune -af --filter until=72h >/dev/null
docker container prune -f --filter until=72h >/dev/null
echo "$(date -Is) ok $(du -sh backups | cut -f1)"
