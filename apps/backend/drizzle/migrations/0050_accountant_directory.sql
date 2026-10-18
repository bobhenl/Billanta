-- Accountant directory ("Sháníte účetní?", /accountants): accountants in the
-- partner programme (tenants.referral_program = 'accountant', migration 0044)
-- can publish a short listing. Nothing is public until a platform admin
-- approves it.
--
--   * accountant_listings: one row per company, OWNED BY THAT COMPANY, so it
--     reads and edits its own listing under RLS. The write policy only lets
--     the company store 'pending' or 'withdrawn': a company can never approve
--     itself, and any edit sends the listing back to review.
--   * public_accountant_listings(): the anonymous read behind the public page.
--     Only approved rows of non-suspended companies still in the accountant
--     programme, only the public columns.
--   * admin_accountant_listings() / review_accountant_listing(): the platform
--     admin queue (PlatformAdminGuard routes). The only cross-company writes.
CREATE TABLE IF NOT EXISTS "accountant_listings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "display_name" text NOT NULL,
  "bio" text,
  "regions" varchar(8)[] NOT NULL DEFAULT '{}',
  "remote" boolean NOT NULL DEFAULT false,
  "services" varchar(24)[] NOT NULL DEFAULT '{}',
  "languages" varchar(4)[] NOT NULL DEFAULT '{}',
  "price_hint" text,
  "contact_email" text,
  "website" text,
  "status" varchar(12) NOT NULL DEFAULT 'pending',
  "review_note" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "accountant_listings" DROP CONSTRAINT IF EXISTS "accountant_listings_status_check";
--> statement-breakpoint
ALTER TABLE "accountant_listings" ADD CONSTRAINT "accountant_listings_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn'));
--> statement-breakpoint
-- A listing without a way to reach the accountant is useless on the page.
ALTER TABLE "accountant_listings" DROP CONSTRAINT IF EXISTS "accountant_listings_contact_check";
--> statement-breakpoint
ALTER TABLE "accountant_listings" ADD CONSTRAINT "accountant_listings_contact_check" CHECK ("contact_email" IS NOT NULL OR "website" IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accountant_listings_tenant_unique" ON "accountant_listings" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accountant_listings_status_idx" ON "accountant_listings" ("status", "updated_at" DESC);
--> statement-breakpoint
ALTER TABLE "accountant_listings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accountant_listings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS accountant_listings_read ON "accountant_listings";
--> statement-breakpoint
CREATE POLICY accountant_listings_read ON "accountant_listings" FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS accountant_listings_insert ON "accountant_listings";
--> statement-breakpoint
CREATE POLICY accountant_listings_insert ON "accountant_listings" FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid AND status IN ('pending', 'withdrawn'));
--> statement-breakpoint
DROP POLICY IF EXISTS accountant_listings_update ON "accountant_listings";
--> statement-breakpoint
CREATE POLICY accountant_listings_update ON "accountant_listings" FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid AND status IN ('pending', 'withdrawn'));
--> statement-breakpoint
DROP POLICY IF EXISTS accountant_listings_delete ON "accountant_listings";
--> statement-breakpoint
CREATE POLICY accountant_listings_delete ON "accountant_listings" FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public_accountant_listings();
--> statement-breakpoint
CREATE FUNCTION public_accountant_listings()
RETURNS TABLE (
  id uuid,
  display_name text,
  bio text,
  regions varchar[],
  remote boolean,
  services varchar[],
  languages varchar[],
  price_hint text,
  contact_email text,
  website text,
  profile_slug text,
  approved_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.display_name, l.bio, l.regions, l.remote, l.services, l.languages, l.price_hint,
         l.contact_email, l.website,
         CASE WHEN (t.public_profile->>'enabled')::boolean IS TRUE THEN lower(t.public_profile->>'slug') END,
         l.reviewed_at
  FROM accountant_listings l
  JOIN tenants t ON t.id = l.tenant_id
  WHERE l.status = 'approved'
    AND t.suspended_at IS NULL
    AND t.referral_program = 'accountant'
  ORDER BY l.reviewed_at DESC NULLS LAST
  LIMIT 500;
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS admin_accountant_listings(text);
--> statement-breakpoint
CREATE FUNCTION admin_accountant_listings(p_status text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  company_name text,
  ico varchar,
  display_name text,
  bio text,
  regions varchar[],
  remote boolean,
  services varchar[],
  languages varchar[],
  price_hint text,
  contact_email text,
  website text,
  status varchar,
  review_note text,
  reviewed_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.tenant_id, t.company_name, t.ico, l.display_name, l.bio, l.regions, l.remote, l.services,
         l.languages, l.price_hint, l.contact_email, l.website, l.status, l.review_note, l.reviewed_at, l.updated_at
  FROM accountant_listings l
  JOIN tenants t ON t.id = l.tenant_id
  WHERE p_status IS NULL OR l.status = p_status
  ORDER BY l.updated_at DESC
  LIMIT 500;
$$;
--> statement-breakpoint
-- Approve or reject one listing. p_updated_at is the version the admin
-- looked at: an edit made in the meantime is not approved unseen.
DROP FUNCTION IF EXISTS review_accountant_listing(uuid, text, text, timestamp with time zone);
--> statement-breakpoint
CREATE FUNCTION review_accountant_listing(p_id uuid, p_status text, p_note text, p_updated_at timestamp with time zone)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN RETURN false; END IF;
  UPDATE accountant_listings
    SET status = p_status, review_note = left(p_note, 500), reviewed_at = now()
    WHERE id = p_id AND status <> 'withdrawn' AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', p_updated_at);
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_accountant_listings() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_accountant_listings(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION review_accountant_listing(uuid, text, text, timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "accountant_listings" TO faktur_app;
    GRANT EXECUTE ON FUNCTION public_accountant_listings() TO faktur_app;
    GRANT EXECUTE ON FUNCTION admin_accountant_listings(text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION review_accountant_listing(uuid, text, text, timestamp with time zone) TO faktur_app;
  END IF;
END $$;
