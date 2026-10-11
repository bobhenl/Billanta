#!/usr/bin/env bash
# Build the images here, ship them to the VPS, migrate, restart.
#   deploy/deploy.sh              # all images
#   SKIP_BUILD=1 deploy/deploy.sh # ship what is already built
#   WITH_AI=1 deploy/deploy.sh    # also the ai-service image (`ai` profile)
set -euo pipefail
HOST=${DEPLOY_HOST:-voxelrank}
DIR=/opt/billanta
SITE_URL=${SITE_URL:-http://149.56.99.247:8090}
cd "$(dirname "$0")/.."

if [ -z "${SKIP_BUILD:-}" ]; then
  docker build -q -f apps/backend/Dockerfile --target runtime -t billanta-backend:latest .
  docker build -q -f apps/backend/Dockerfile --target migrate -t billanta-migrate:latest .
  docker build -q -f apps/frontend/Dockerfile --build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" -t billanta-frontend:latest .
  if [ -n "${WITH_AI:-}" ]; then docker build -q -f apps/ai-service/Dockerfile -t billanta-ai:latest .; fi
fi
IMAGES="billanta-backend:latest billanta-migrate:latest billanta-frontend:latest"
if [ -n "${WITH_AI:-}" ]; then IMAGES="$IMAGES billanta-ai:latest"; fi

echo "uploading images…"
docker save $IMAGES | gzip -1 | ssh "$HOST" 'gunzip | docker load -q'

echo "uploading compose files…"
tar czf - deploy docker/postgres .env.example | ssh "$HOST" "mkdir -p $DIR && tar xzf - -C $DIR && chmod +x $DIR/deploy/*.sh"
ssh "$HOST" "[ -e $DIR/.env ] || $DIR/deploy/init-env.sh '$SITE_URL'"

ssh "$HOST" "cd $DIR && C='docker compose -f deploy/docker-compose.prod.yml --env-file .env' \
  && \$C up -d postgres redis && \$C run --rm migrate && \$C up -d --remove-orphans && \$C ps \
  && docker image rm -f billanta-migrate:latest >/dev/null"
# The migrate image (~2.6 GB unpacked) is only needed above and is shipped
# again on every deploy, so it is not kept on the small VPS disk.
git rev-parse --short HEAD | ssh "$HOST" "cat > $DIR/.deployed_sha"
