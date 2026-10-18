-- Buyer-details links, round two, plus contact phone numbers.
--
-- 1. Shorter links: new tokens are 12 base62 characters instead of a UUID,
--    so /d/<token> fits in a text message. The column becomes text; links
--    already sent keep their UUID (printed in lower case by the cast) and
--    keep working. The unique index is rebuilt by the type change.
-- 2. Required fields: the company picks which of e-mail, phone, IČO and DIČ
--    a customer has to fill in (tenants default, per-link override). The
--    server checks them on submit (BuyerDetailsService.applySubmission).
-- 3. contacts.phone: the customer can leave a phone number on the page.
--
-- get_buyer_details_target took a uuid; it is recreated for text with the
-- same body and hardening (mirrored in rls-policies.sql).
DROP FUNCTION IF EXISTS get_buyer_details_target(uuid);
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "buyer_details_token" TYPE text USING "buyer_details_token"::text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_details_required" text[];
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "buyer_details_required" text[] NOT NULL DEFAULT '{email,ico}'::text[];
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
DROP FUNCTION IF EXISTS get_buyer_details_target(text);
--> statement-breakpoint
CREATE FUNCTION get_buyer_details_target(p_token text)
RETURNS TABLE (tenant_id uuid, invoice_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.tenant_id, i.id
  FROM invoices i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.buyer_details_token = p_token
    AND t.suspended_at IS NULL
    AND i.status IN ('draft', 'pending_review')
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_buyer_details_target(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION get_buyer_details_target(text) TO faktur_app;
  END IF;
END $$;
