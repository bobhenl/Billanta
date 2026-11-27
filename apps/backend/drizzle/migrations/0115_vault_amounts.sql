-- "Důvěrný režim", category "amounts": the browser seals each line item's
-- quantity, unit price, VAT rate and discount, and the document's totals,
-- before saving (enc:v1: envelopes under the document key). The plain
-- columns then hold placeholders (quantity 1, price 0, no rate), so any
-- server sum of a sealed document is 0 and never a real amount. VS, number,
-- dates, currency and status stay readable. No policy changes: the columns
-- live in tables that already have the tenant policy.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "enc_amounts" text;
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "enc_amounts" text;
--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD COLUMN IF NOT EXISTS "enc_amounts" text;
