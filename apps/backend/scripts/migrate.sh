#!/bin/sh
# Production migration step (deploy/docker-compose.prod.yml `migrate`):
# Drizzle migrations, then the hand-written RLS policies (re-runnable),
# then the faktur_app grants. DATABASE_URL must be the superuser/owner.
set -eu
cd /repo/apps/backend

pnpm exec drizzle-kit migrate

# Re-runnable (policies dropped first, CREATE OR REPLACE FUNCTION).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f drizzle/rls-policies.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f drizzle/app-role-grants.sql
echo "migrations applied"
