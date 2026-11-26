-- Monthly usage counters behind the plan limits on the pricing page: issued
-- documents (Free: 10 a month), AI credits, public-API requests, and the
-- "taste" uses lower plans get of a paid feature (one Pohoda export a month,
-- one VAT filing download in total). One row per tenant, metric and period;
-- period is YYYY-MM or 'all' for a lifetime allowance. The app increments
-- with an upsert that checks the limit in the same statement, so two
-- parallel requests cannot both take the last unit.
CREATE TABLE IF NOT EXISTS "tenant_usage" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "metric" varchar(48) NOT NULL,
  "period" varchar(7) NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("tenant_id", "metric", "period")
);
--> statement-breakpoint
ALTER TABLE "tenant_usage" DROP CONSTRAINT IF EXISTS "tenant_usage_period_check";
--> statement-breakpoint
ALTER TABLE "tenant_usage" ADD CONSTRAINT "tenant_usage_period_check" CHECK ("period" ~ '^([0-9]{4}-[0-9]{2}|all)$');
--> statement-breakpoint
ALTER TABLE "tenant_usage" DROP CONSTRAINT IF EXISTS "tenant_usage_count_check";
--> statement-breakpoint
ALTER TABLE "tenant_usage" ADD CONSTRAINT "tenant_usage_count_check" CHECK ("count" >= 0);
--> statement-breakpoint
ALTER TABLE "tenant_usage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_usage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenant_usage";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_usage"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
-- Migrations run as the table owner; grant here too when the app role
-- already exists (app-role-grants.sql covers it again after every migrate).
-- No DELETE: a counter must not be resettable from the app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "tenant_usage" TO faktur_app;
    REVOKE DELETE ON "tenant_usage" FROM faktur_app;
  END IF;
END
$$;
