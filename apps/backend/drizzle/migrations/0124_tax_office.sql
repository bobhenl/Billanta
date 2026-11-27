-- Offices and residence address for the filings (Settings -> Company).
-- tax_office / tax_workplace go into VetaP c_ufo / c_pracufo of the EPO VAT
-- files and into the DAP; the XSDs require c_ufo. health_insurer and
-- social_office prefill the OSVČ přehledy. residence_* is an OSVČ's trvalý
-- pobyt, used in VetaP of a natural person when filled. All nullable: empty
-- keeps the old behaviour. The tenants table keeps its RLS policy from
-- rls-policies.sql, which needs no change for new columns.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tax_office" smallint;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tax_workplace" smallint;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "health_insurer" varchar(3);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "social_office" smallint;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "residence_street" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "residence_city" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "residence_postal_code" varchar(10);
