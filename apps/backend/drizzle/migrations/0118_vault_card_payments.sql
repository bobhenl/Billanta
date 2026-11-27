-- "Důvěrný režim", category "amounts": a card payment of a document whose
-- amounts are sealed. The server books the document paid as before, but it
-- cannot seal the payment (only the browser has the document key), so the
-- checkout row waits as `seal_state = 'pending'` with the plain amount and
-- fee the user already revealed for the card (invoices.card_amount, 0117).
-- The next browser with the unlocked vault seals it into
-- invoice_sealed_payments; the row becomes 'sealed' and drops both numbers.
--   * 'dropped': the document was marked unpaid before anyone sealed it;
--     its payments go, and so do the plain numbers.
ALTER TABLE "card_payment_sessions" ADD COLUMN IF NOT EXISTS "seal_state" text;
--> statement-breakpoint
ALTER TABLE "card_payment_sessions" ADD COLUMN IF NOT EXISTS "sealed_payment_id" uuid REFERENCES "invoice_sealed_payments"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "card_payment_sessions" ALTER COLUMN "amount" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "card_payment_sessions" DROP CONSTRAINT IF EXISTS "card_payment_sessions_seal_state_check";
--> statement-breakpoint
ALTER TABLE "card_payment_sessions" ADD CONSTRAINT "card_payment_sessions_seal_state_check" CHECK (
  "seal_state" IS NULL
  OR ("seal_state" = 'pending' AND "status" = 'paid' AND "amount" IS NOT NULL)
  OR ("seal_state" IN ('sealed', 'dropped') AND "amount" IS NULL AND "fee" IS NULL)
);
--> statement-breakpoint
-- Only a sealed or dropped card payment of a sealed document may lose its amount.
ALTER TABLE "card_payment_sessions" DROP CONSTRAINT IF EXISTS "card_payment_sessions_amount_check";
--> statement-breakpoint
ALTER TABLE "card_payment_sessions" ADD CONSTRAINT "card_payment_sessions_amount_check" CHECK ("amount" IS NOT NULL OR "seal_state" IN ('sealed', 'dropped'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_payment_sessions_sealed_payment_uniq" ON "card_payment_sessions" ("sealed_payment_id") WHERE "sealed_payment_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_payment_sessions_seal_pending_idx" ON "card_payment_sessions" ("tenant_id", "invoice_id") WHERE "seal_state" = 'pending';
--> statement-breakpoint
-- Now that the dashboard lists them, card payments follow their invoice like
-- its sealed payments (0117): a private invoice's are as hidden as it is.
DROP POLICY IF EXISTS member_visibility ON "card_payment_sessions";
--> statement-breakpoint
CREATE POLICY member_visibility ON "card_payment_sessions" AS RESTRICTIVE
  USING (CASE (SELECT app_view_mode())
    WHEN 'full' THEN true
    ELSE EXISTS (SELECT 1 FROM invoices i WHERE i.id = card_payment_sessions.invoice_id)
  END);
