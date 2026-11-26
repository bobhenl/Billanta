-- A PSD2 account can be a personal one: the owner lists the words a movement
-- must contain (e.g. "Google") and nothing else from it is stored. The
-- account's currency tells apart the sub-accounts that share one IBAN (Revolut).
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "import_filter" text;
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "currency" varchar(3);
