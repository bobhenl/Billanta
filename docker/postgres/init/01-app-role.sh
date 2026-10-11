#!/bin/sh
# Runs once, on the first start of an empty postgres_data volume
# (docker-entrypoint-initdb.d). Creates the runtime role the backend connects
# as. It is not a superuser and does not own the tables, so the RLS policies
# apply to it. Table grants come from the migrations and
# apps/backend/drizzle/app-role-grants.sql (run after `db:migrate`).
set -eu

if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "APP_DB_PASSWORD is not set" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE faktur_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app')
\gexec
GRANT CONNECT ON DATABASE :"DBNAME" TO faktur_app;
GRANT USAGE ON SCHEMA public TO faktur_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
