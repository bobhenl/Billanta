-- Two Slovak demo companies for /demo: a translator who is not a VAT payer
-- (sk_freelancer) and an electrician who is (sk_vat_freelancer). Widens the
-- demo_kind check from 0068; drop-then-add keeps it idempotent.
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_demo_kind_check";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_demo_kind_check"
  CHECK ("demo_kind" IS NULL OR "demo_kind" IN ('cz_vat_sro', 'cz_freelancer', 'cz_pausal', 'sk_vat_sro', 'sk_freelancer', 'sk_vat_freelancer'));
