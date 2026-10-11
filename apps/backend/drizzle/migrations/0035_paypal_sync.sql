-- PayPal as a payment source: the hourly sync pulls received payments from
-- the PayPal Transaction Search API with the fee PayPal kept, matches them
-- to invoices like bank payments, and books the fee on the invoice.
ALTER TYPE "bank_statement_source" ADD VALUE IF NOT EXISTS 'paypal';
--> statement-breakpoint
ALTER TABLE "bank_connections" DROP CONSTRAINT IF EXISTS "bank_connections_provider_check";
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_provider_check" CHECK ("provider" IN ('fio', 'enable_banking', 'paypal'));
--> statement-breakpoint
ALTER TABLE "bank_connections" DROP CONSTRAINT IF EXISTS "bank_connections_token_check";
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_token_check"
  CHECK ("provider" = 'enable_banking' OR "token_encrypted" IS NOT NULL);
--> statement-breakpoint
-- Fee kept by the payment provider (PayPal), in the transaction currency; null for bank rows.
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "fee" numeric(14, 2);
