-- Grants for the RLS-bound runtime role `faktur_app` (created by
-- docker/postgres/init/01-app-role.sh). Run as the table-owning migration
-- role after every `db:migrate`; it is idempotent:
--
--   psql "$MIGRATION_DATABASE_URL" -f drizzle/app-role-grants.sql
--
-- Several migrations grant their own tables only when `faktur_app` already
-- exists, and the early ones grant nothing, so this file brings any database
-- to the same state as the dev database.

GRANT USAGE ON SCHEMA public TO faktur_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO faktur_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO faktur_app;

-- The outbound e-mail log is append-only for the app (abuse audit trail).
REVOKE UPDATE, DELETE ON outbound_emails FROM faktur_app;

-- Same for the activity history (migration 0038 grants only SELECT, INSERT).
REVOKE UPDATE, DELETE ON audit_log FROM faktur_app;

-- Global catalogs the app only reads; plans and terms change via migrations.
REVOKE INSERT, UPDATE, DELETE ON subscription_plans, tos_versions FROM faktur_app;

-- SECURITY DEFINER helpers: callable by the app, not by PUBLIC.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO faktur_app;
