# apps/backup/Dockerfile — pg_dump + rclone backup sidecar.
#
# Build context is the MONOREPO ROOT (see root docker-compose.yml's
# `build.context: .` for this service, matching apps/backend and friends),
# even though this image only needs its own backup.sh -- kept consistent
# with the rest of the repo's Dockerfiles rather than a special case.
#
# postgresql16-client matches the `postgres:16-alpine` service in the root
# docker-compose.yml, so pg_dump's wire/dump-format version stays compatible
# with the server it's dumping (mismatched major versions is the classic way
# to get a pg_dump that silently produces a dump the matching pg_restore/
# psql can't fully replay).
FROM alpine:3.19

RUN apk add --no-cache \
      bash \
      postgresql16-client \
      rclone \
      tzdata

# rclone's own official Docker image reads its config from
# $XDG_CONFIG_HOME/rclone/rclone.conf; setting XDG_CONFIG_HOME=/config here
# matches that convention, so the read-only volume mount documented in root
# docker-compose.yml (./rclone.conf:/config/rclone/rclone.conf:ro) lands
# exactly where rclone already looks -- backup.sh also passes --config
# explicitly, so this is belt-and-suspenders, not load-bearing.
ENV XDG_CONFIG_HOME=/config

WORKDIR /app
COPY apps/backup/backup.sh ./backup.sh
RUN chmod +x ./backup.sh

# Local staging dir for the gzip'd dump before/after upload; see
# BACKUP_LOCAL_DIR in backup.sh and the `backup_data` volume in
# docker-compose.yml. Not required to persist across container recreation
# (rclone is the durable copy) but keeping it as a volume means the last
# few local dumps survive a container restart too.
VOLUME ["/backups"]

ENTRYPOINT ["bash", "./backup.sh"]
