-- When each sign-in session started. Accounts without a password (Google,
-- Seznam, … only) have nothing to re-enter before setting a password,
-- changing the sign-in email or deleting the account, so those changes ask
-- for a session started in the last few minutes instead
-- (apps/frontend/app/[locale]/(dashboard)/settings/profile/actions.ts).
-- Rows that exist when this runs get now(), so they count as fresh only
-- for those first minutes.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
