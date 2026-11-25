#!/bin/sh
# Usage (on the VPS, from /opt/billanta with the commit unpacked in ./src):
#   ./src/deploy/deploy-pull.sh <full commit sha>
# Pulls the images that .github/workflows/images.yml built for that commit
# instead of building them here, then migrates and restarts. Waits up to
# 25 minutes for the workflow to finish pushing.
set -e
SHA=${1:?usage: deploy-pull.sh <full commit sha>}
D=/opt/billanta; S=$D/src; R=ghcr.io/bobhenl
cd $D

for n in frontend backend migrate; do
  i=0
  until docker pull -q "$R/billanta-$n:$SHA" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ $i -ge 75 ]; then echo "ERROR: $R/billanta-$n:$SHA not in the registry"; exit 1; fi
    [ $i -eq 1 ] && echo "== waiting for billanta-$n:$SHA $(date +%T)"
    sleep 20
  done
  docker tag "$R/billanta-$n:$SHA" "billanta-$n:latest"
  echo "== pulled billanta-$n $(date +%T)"
done

echo "== compose files $(date +%T)"
cp -r $S/deploy $S/docker $D/; cp $S/.env.example $D/ 2>/dev/null || true; chmod +x $D/deploy/*.sh
sed -i "s/^WHATSAPP_VERIFY_TOKEN=/WHATSAPP_WEBHOOK_VERIFY_TOKEN=/" $D/.env
C="docker compose -f deploy/docker-compose.prod.yml --env-file .env"
echo "== migrate $(date +%T)"; $C up -d postgres redis; $C run --rm migrate
echo "== restart $(date +%T)"; $C up -d --remove-orphans; $C ps --format "{{.Service}} {{.Status}}"

# The migrate image (~1.8 GB) is only needed for the run above; the disk is small.
docker rmi billanta-migrate:latest "$R/billanta-migrate:$SHA" >/dev/null 2>&1 || true
# Only this commit's registry tags stay; the rest are dangling copies.
docker images --format '{{.Repository}}:{{.Tag}}' | grep "^$R/" | grep -v ":$SHA\$" | xargs -r docker rmi >/dev/null 2>&1 || true
docker image prune -f >/dev/null
echo "$SHA" | cut -c1-7 > $D/.deployed_sha
echo "== DEPLOY DONE $(date +%T) $(df -h / | tail -1)"
