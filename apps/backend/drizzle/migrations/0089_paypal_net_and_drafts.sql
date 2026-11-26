-- PayPal payments converted to the home currency inside PayPal: keep what
-- actually arrived (after the fee and PayPal's rate) next to the payment, so
-- the invoice it pays can show the net amount. And the day from which an
-- unmatched PayPal payment becomes an invoice draft: payments before it are
-- assumed to be invoiced already (imported history).
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "net_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "net_currency" varchar(3);
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "auto_draft_from" timestamp with time zone;
