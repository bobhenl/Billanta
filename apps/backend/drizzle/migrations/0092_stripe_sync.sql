-- Stripe as a payment source: the hourly sync pulls received charges from
-- Stripe's balance transactions with a read-only restricted key, matches
-- them to invoices like bank payments, and books Stripe's fee (in
-- bank_transactions.fee, added for PayPal in 0035).
ALTER TYPE "bank_statement_source" ADD VALUE IF NOT EXISTS 'stripe';
--> statement-breakpoint
ALTER TABLE "bank_connections" DROP CONSTRAINT IF EXISTS "bank_connections_provider_check";
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_provider_check" CHECK ("provider" IN ('fio', 'enable_banking', 'paypal', 'stripe'));
