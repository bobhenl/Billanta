-- Card payments from the client portal (Invoice Ninja's / Fakturoid's "pay
-- online" button): each company connects its OWN Stripe account with a
-- secret or restricted key, so the money goes straight to the company and
-- Billanta never holds it. A Checkout Session is created per payment attempt
-- and recorded here; it is confirmed when the payer returns, and an
-- every-15-minutes sweep catches payers who closed the tab first.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_secret_key_encrypted" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_account_name" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "card_payments_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_payment_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "provider" varchar(16) NOT NULL DEFAULT 'stripe',
  "session_id" text NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'open',
  "fee" numeric(14, 2),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "paid_at" timestamp with time zone,
  CONSTRAINT "card_payment_sessions_status_check" CHECK ("status" IN ('open', 'paid', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_payment_sessions_session_uniq" ON "card_payment_sessions" ("provider", "session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_payment_sessions_open_idx" ON "card_payment_sessions" ("tenant_id", "status", "created_at");
--> statement-breakpoint
ALTER TABLE "card_payment_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "card_payment_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "card_payment_sessions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "card_payment_sessions"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "card_payment_sessions" TO faktur_app;
  END IF;
END $$;
--> statement-breakpoint
-- The public /i/:token page asks whether it may offer card payment and, when
-- the payer clicks, which company (and Stripe key) the invoice belongs to.
-- Same hardening as the other get_public_* functions: one static SELECT on
-- the unguessable token, nothing for drafts or suspended companies. The
-- encrypted key never leaves the backend (it is not part of any response).
DROP FUNCTION IF EXISTS get_public_card_payment_target(uuid);
--> statement-breakpoint
CREATE FUNCTION get_public_card_payment_target(p_public_token uuid)
RETURNS TABLE (
  tenant_id uuid,
  invoice_id uuid,
  invoice_number text,
  currency text,
  status text,
  document_type text,
  amount_paid numeric,
  company_name text,
  stripe_secret_key_encrypted text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.tenant_id, i.id, i.invoice_number, i.currency::text, i.status::text, i.document_type::text,
         i.amount_paid, t.company_name, t.stripe_secret_key_encrypted
  FROM invoices i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.public_token = p_public_token
    AND t.suspended_at IS NULL
    AND t.card_payments_enabled
    AND t.stripe_secret_key_encrypted IS NOT NULL
    AND i.status NOT IN ('draft', 'pending_review')
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_public_card_payment_target(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION get_public_card_payment_target(uuid) TO faktur_app;
  END IF;
END $$;
