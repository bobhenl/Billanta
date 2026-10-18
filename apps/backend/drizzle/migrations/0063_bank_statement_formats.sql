-- Bank matching supports two inputs: the Fio API and uploaded statements.
--
-- * Uploads now also take camt.053 (ISO 20022 XML) and GPC/ABO files, so
--   the import source gets two values.
-- * The Fio sync moves from the `periods` endpoint to `last` with Fio's
--   server-side cursor. `fio_last_id` is the highest movement id we have
--   stored, `fio_cursor_ready` says whether Fio's cursor is known to sit
--   there (false until set-last-id / set-last-date ran), and
--   `last_request_at` keeps every call to one token 30 s apart, which Fio
--   enforces for all of its endpoints.
-- * `message` keeps the payer's note for manual review.
-- * The (tenant, day) index serves the duplicate check, which compares an
--   upload with the rows already stored for the same days.
ALTER TYPE "bank_statement_source" ADD VALUE IF NOT EXISTS 'camt053';
--> statement-breakpoint
ALTER TYPE "bank_statement_source" ADD VALUE IF NOT EXISTS 'gpc';
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "fio_last_id" bigint;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "fio_cursor_ready" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "last_request_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "message" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_transactions_tenant_date_idx" ON "bank_transactions" ("tenant_id", "transaction_date");
