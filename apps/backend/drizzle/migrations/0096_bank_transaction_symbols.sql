-- The constant and specific symbol of a payment, so a draft made from it
-- carries the same symbols as the payment (VS already does).
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "constant_symbol" text;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "specific_symbol" text;
