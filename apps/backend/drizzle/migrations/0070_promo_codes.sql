-- Promo codes for the growth channels (networking events, creators, schools).
-- Billanta staff issue them in the admin area; a company redeems one at
-- sign-up (/signup?promo=CODE) or later in Billing.
--
--   * promo_codes: GLOBAL catalogue (no tenant, no RLS), like partners. The
--     benefit is extra trial days or free (prepaid) months of a plan, which is
--     what tenants.trial_* / prepaid_* already model. redemption_count is
--     bumped by the redeeming company's own transaction under a row lock, so
--     max_redemptions holds without reading other tenants' rows.
--   * promo_redemptions: tenant-scoped, one row per company (one code per
--     company, ever). The company sees and inserts its own row; nothing can be
--     changed or deleted afterwards (app-role-grants.sql). It keeps the code
--     and benefit as redeemed, for attribution (and creator commissions later).
--   * promo_code_stats(): per-code totals across companies for the admin
--     list (redemptions and how many of those companies pay now). Counts only,
--     never which companies.
CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(32) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "benefit_type" varchar(16) NOT NULL,
  "benefit_plan" varchar(16) NOT NULL,
  "benefit_value" integer NOT NULL,
  "max_redemptions" integer,
  "redemption_count" integer NOT NULL DEFAULT 0,
  "valid_from" date,
  "valid_until" date,
  "active" boolean NOT NULL DEFAULT true,
  "owner_label" text,
  "note" text,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "promo_codes" DROP CONSTRAINT IF EXISTS "promo_codes_kind_check";
--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_kind_check" CHECK ("kind" IN ('event', 'creator', 'school', 'other'));
--> statement-breakpoint
ALTER TABLE "promo_codes" DROP CONSTRAINT IF EXISTS "promo_codes_benefit_check";
--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_benefit_check" CHECK (
  "benefit_plan" IN ('start', 'plus', 'business')
  AND (("benefit_type" = 'trial_days' AND "benefit_value" BETWEEN 1 AND 365)
    OR ("benefit_type" = 'free_months' AND "benefit_value" BETWEEN 1 AND 24))
);
--> statement-breakpoint
ALTER TABLE "promo_codes" DROP CONSTRAINT IF EXISTS "promo_codes_limits_check";
--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_limits_check" CHECK (
  ("max_redemptions" IS NULL OR "max_redemptions" > 0)
  AND "redemption_count" >= 0
  AND ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_from" <= "valid_until")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_code_unique" ON "promo_codes" (upper("code"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promo_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "promo_code_id" uuid NOT NULL REFERENCES "promo_codes"("id"),
  "code" varchar(32) NOT NULL,
  "benefit_type" varchar(16) NOT NULL,
  "benefit_plan" varchar(16) NOT NULL,
  "benefit_value" integer NOT NULL,
  "source" varchar(16) NOT NULL CHECK ("source" IN ('signup', 'billing')),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- One code per company: a second redeem (or two at once) hits this index.
CREATE UNIQUE INDEX IF NOT EXISTS "promo_redemptions_tenant_unique" ON "promo_redemptions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promo_redemptions_code_idx" ON "promo_redemptions" ("promo_code_id");
--> statement-breakpoint
ALTER TABLE "promo_redemptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "promo_redemptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS promo_redemptions_read ON "promo_redemptions";
--> statement-breakpoint
CREATE POLICY promo_redemptions_read ON "promo_redemptions" FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS promo_redemptions_insert ON "promo_redemptions";
--> statement-breakpoint
CREATE POLICY promo_redemptions_insert ON "promo_redemptions" FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
-- Per code: companies that redeemed it and how many of them pay right now.
-- Paying means a live card subscription; a prepaid period may be nothing but
-- the free months the code gave, so it doesn't count.
DROP FUNCTION IF EXISTS promo_code_stats();
--> statement-breakpoint
CREATE FUNCTION promo_code_stats()
RETURNS TABLE (promo_code_id uuid, redemptions integer, paying integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.promo_code_id,
         count(*)::int,
         count(*) FILTER (
           WHERE t.subscription_plan IN ('start', 'plus', 'business')
             AND t.subscription_status IN ('active', 'past_due')
         )::int
    FROM promo_redemptions r
    JOIN tenants t ON t.id = r.tenant_id
   GROUP BY r.promo_code_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION promo_code_stats() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "promo_codes" TO faktur_app;
    GRANT SELECT, INSERT ON "promo_redemptions" TO faktur_app;
    GRANT EXECUTE ON FUNCTION promo_code_stats() TO faktur_app;
  END IF;
END $$;
