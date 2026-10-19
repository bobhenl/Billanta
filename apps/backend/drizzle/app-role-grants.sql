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

-- Referrals and credit grants are written only by claim_referral /
-- reward_referral (migration 0044); the app may only record spends.
REVOKE INSERT, UPDATE, DELETE ON referrals FROM faktur_app;
REVOKE UPDATE, DELETE ON credit_ledger FROM faktur_app;

-- The e-mail outbox keeps its history; the worker finishes rows through
-- finish_email_outbox (migration 0049). The suppression list is reached only
-- through that migration's functions.
REVOKE DELETE ON email_outbox FROM faktur_app;
REVOKE ALL ON email_suppressions FROM faktur_app;
-- Trial claims are read and written only by bootstrap_tenant_for_user, and
-- Billanta's own proformas are marked paid only by mark_platform_proforma_paid
-- (migration 0051); the app may request (insert) a pending one for its tenant.
REVOKE ALL ON trial_claims FROM faktur_app;
REVOKE UPDATE, DELETE ON platform_proformas FROM faktur_app;
-- Demo bookkeeping (per-IP hashes, AI counts) only through the demo
-- functions of migration 0068.
REVOKE ALL ON demo_sessions FROM faktur_app;

-- A company's promo redemption is its attribution record (migration 0070):
-- inserted once, never edited. Codes are switched off, not deleted.
REVOKE UPDATE, DELETE ON promo_redemptions FROM faktur_app;
REVOKE DELETE ON promo_codes FROM faktur_app;

-- E-invoices are tax documents with a 10-year archive duty (§ 85o ods. 15
-- ZoDPH, migration 0074): the app may never delete them, and the status log
-- is append-only.
REVOKE DELETE ON einvoice_participants, outgoing_einvoices, incoming_einvoices FROM faktur_app;
REVOKE UPDATE, DELETE ON einvoice_status_events FROM faktur_app;

-- Global catalogs the app only reads; plans and terms change via migrations.
REVOKE INSERT, UPDATE, DELETE ON subscription_plans, tos_versions FROM faktur_app;

-- SECURITY DEFINER helpers: callable by the app, not by PUBLIC.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO faktur_app;
