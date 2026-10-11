-- Net proceeds of a payment: fees the payment provider kept (PayPal, Stripe,
-- Wise…, in the invoice currency) and the amount actually credited in CZK,
-- so a foreign-currency invoice shows its real margin and exchange difference.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_fees" numeric(14, 2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "received_czk" numeric(14, 2);
