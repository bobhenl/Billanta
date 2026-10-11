#!/bin/sh
# Run once on the VPS: writes /opt/billanta/.env with fresh random secrets.
# Third-party keys stay empty (those integrations stay off) and are filled
# in by hand later. Never overwrites an existing .env.
set -eu
cd /opt/billanta
[ -e .env ] && { echo ".env already exists, not touching it"; exit 0; }
SITE_URL=${1:?usage: init-env.sh http://149.56.99.247:8090}
umask 077
hex() { openssl rand -hex "$1"; }
JWT=$(openssl rand -base64 48 | tr -d '\n')
AUTH=$(openssl rand -base64 48 | tr -d '\n')
sed -e "s|^POSTGRES_USER=.*|POSTGRES_USER=billanta|" \
    -e "s|^POSTGRES_DB=.*|POSTGRES_DB=billanta|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(hex 24)|" \
    -e "s|^APP_DB_PASSWORD=.*|APP_DB_PASSWORD=$(hex 24)|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" \
    -e "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$AUTH|" \
    -e "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=$SITE_URL|" \
    -e "s|^NEXT_PUBLIC_SITE_URL=.*|NEXT_PUBLIC_SITE_URL=$SITE_URL|" \
    -e "s|^AI_KEY_ENCRYPTION_KEY=.*|AI_KEY_ENCRYPTION_KEY=$(hex 32)|" \
    -e "s|^BACKUP_CONFIG_ENCRYPTION_KEY=.*|BACKUP_CONFIG_ENCRYPTION_KEY=$(hex 32)|" \
    -e "s|^TELEGRAM_WEBHOOK_SECRET=.*|TELEGRAM_WEBHOOK_SECRET=$(hex 24)|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=|" \
    -e "s|^REDIS_URL=.*|REDIS_URL=redis://redis:6379|" \
    -e "s|^BACKEND_URL=.*|BACKEND_URL=http://backend:3000|" \
    .env.example > .env
printf 'AUTH_SECRET=%s\nAUTH_URL=%s\nPUBLIC_SITE_URL=%s\n' "$AUTH" "$SITE_URL" "$SITE_URL" >> .env
echo ".env written ($(grep -c = .env) keys)"
