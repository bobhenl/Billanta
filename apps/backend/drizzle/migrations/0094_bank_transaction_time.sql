-- The exact moment of a payment, when the source sends one (PayPal, Stripe).
-- transaction_date stays the Prague day for tax dates; this only orders
-- payments of one day the way the provider shows them.
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "occurred_at" timestamp with time zone;
