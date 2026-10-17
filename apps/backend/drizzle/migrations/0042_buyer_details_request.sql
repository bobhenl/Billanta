-- "Odběratel si doplní údaje sám": a draft can be sent to the customer, who
-- fills in their own billing details at /d/:buyer_details_token. The token is
-- a separate random secret (not public_token), so the request can be closed
-- or replaced without touching the invoice's normal client link.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_details_token" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_details_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_details_requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_details_email" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_details_auto_issue" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_details_submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_details_outcome" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_buyer_details_token_unique" ON "invoices" ("buyer_details_token");
--> statement-breakpoint
-- Which company and draft a buyer-details link belongs to. Same hardening as
-- the get_public_* functions: one static SELECT on the unguessable token,
-- nothing for suspended companies, and only while the document is still a
-- draft. Everything else then runs in an ordinary tenant-scoped transaction.
DROP FUNCTION IF EXISTS get_buyer_details_target(uuid);
--> statement-breakpoint
CREATE FUNCTION get_buyer_details_target(p_token uuid)
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
REVOKE ALL ON FUNCTION get_buyer_details_target(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION get_buyer_details_target(uuid) TO faktur_app;
  END IF;
END $$;
