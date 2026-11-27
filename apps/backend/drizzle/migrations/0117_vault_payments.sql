-- "Důvěrný režim", category "amounts": payments of a document whose amounts
-- are sealed. The browser seals each payment's sum, fee and home-currency
-- proceeds under the document key (`enc_amount`); the server keeps the
-- date, the VS, the matched bank transaction and the state the browser
-- computed from the opened numbers (`invoices.sealed_payment_state`).
--   * paid_at NULL: the sum a document already had when its amounts were
--     sealed, carried over without a date.
--   * invoices.card_amount: the one plain amount the user may opt into, per
--     document, so the client can pay it by card (Stripe charges a number).
CREATE TABLE IF NOT EXISTS "invoice_sealed_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE cascade,
  "paid_at" date,
  "variable_symbol" text,
  "bank_transaction_id" uuid REFERENCES "bank_transactions"("id") ON DELETE set null,
  "enc_amount" text NOT NULL CHECK ("enc_amount" LIKE 'enc:v1:%'),
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_sealed_payments_invoice_idx" ON "invoice_sealed_payments" ("invoice_id");
--> statement-breakpoint
ALTER TABLE "invoice_sealed_payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_sealed_payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "invoice_sealed_payments";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice_sealed_payments"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
-- Payments follow their invoice, like its items and files (0111).
DROP POLICY IF EXISTS member_visibility ON "invoice_sealed_payments";
--> statement-breakpoint
CREATE POLICY member_visibility ON "invoice_sealed_payments" AS RESTRICTIVE
  USING (CASE (SELECT app_view_mode())
    WHEN 'full' THEN true
    ELSE EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_sealed_payments.invoice_id)
  END);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "invoice_sealed_payments" TO faktur_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sealed_payment_state" text;
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_sealed_payment_state_check";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sealed_payment_state_check" CHECK ("sealed_payment_state" IS NULL OR "sealed_payment_state" = 'partly_paid');
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "card_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_card_amount_check";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_card_amount_check" CHECK ("card_amount" IS NULL OR "card_amount" > 0);
