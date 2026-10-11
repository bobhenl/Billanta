-- PSD2 bank connections through Enable Banking (account information only).
-- A connection is created "pending" when the user is sent to their bank and
-- becomes "active" once the bank redirects back with an authorisation code.
-- Consent lasts at most 180 days (often 90), then it needs renewing.
ALTER TYPE "bank_statement_source" ADD VALUE IF NOT EXISTS 'psd2';
--> statement-breakpoint
ALTER TABLE "bank_connections" DROP CONSTRAINT IF EXISTS "bank_connections_provider_check";
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_provider_check" CHECK ("provider" IN ('fio', 'enable_banking'));
--> statement-breakpoint
ALTER TABLE "bank_connections" ALTER COLUMN "token_encrypted" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_status_check" CHECK ("status" IN ('pending', 'active', 'expired'));
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "bank_name" text;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "bank_country" varchar(2);
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "auth_state" text;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "external_session_id" text;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "external_account_id" text;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "consent_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_token_check"
  CHECK ("provider" <> 'fio' OR "token_encrypted" IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_connections_auth_state_uniq" ON "bank_connections" ("auth_state") WHERE "auth_state" IS NOT NULL;
