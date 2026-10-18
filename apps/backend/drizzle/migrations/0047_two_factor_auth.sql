-- Two-factor sign-in (TOTP authenticator apps plus one-time recovery codes).
--
-- users: the TOTP secret is stored AES-GCM encrypted by the frontend (key
-- derived from the auth secret), so a copy of the database alone cannot
-- mint codes. Recovery codes are kept only as SHA-256 hashes. totp_last_step
-- rejects a code that was already used (replay within its 30 s window).
--
-- sessions: every session of a user with 2FA on starts as pending and
-- unlocks nothing (no dashboard, no backend token) until a code is entered.
-- two_factor_at marks a session that passed the check; the backend JWT then
-- carries `mfa`, which bank connections, API keys, webhooks and backup
-- destinations require.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_recovery_codes" text[];
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_last_step" integer;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "two_factor_pending" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "two_factor_at" timestamp with time zone;
