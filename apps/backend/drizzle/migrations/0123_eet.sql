-- EET 2.0 (zákon č. 180/2026 Sb., from 1. 1. 2027; docs/eet.md, src/eet/).
-- Opt-in per company: the evidenční jednotka and pokladna from DIS+, the
-- pokladní certifikát (encrypted like the AI key), and whether card payments
-- are taken in person. A kontaktní platba of an invoice becomes a row in
-- eet_records with the POK the Financial Administration answers with; rows
-- without an answer are resent by EetCron for 48 hours (§ 20). Playground is
-- the default environment, production has to be chosen.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eet_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eet_environment" varchar(16) NOT NULL DEFAULT 'playground';
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_eet_environment_check";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_eet_environment_check" CHECK ("eet_environment" IN ('playground', 'production'));
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eet_id_jednotky" varchar(9);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eet_id_pokl" varchar(20);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eet_card_in_person" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eet_certificate_encrypted" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eet_certificate_info" jsonb;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "eet_last_porad_cis" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "eet_pok" varchar(39);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eet_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "kind" varchar(8) NOT NULL,
  "environment" varchar(16) NOT NULL,
  "eic_popl" varchar(12) NOT NULL,
  "id_jednotky" varchar(9) NOT NULL,
  "id_pokl" varchar(20) NOT NULL,
  "porad_cis" varchar(25) NOT NULL,
  "dat_trzby" varchar(25) NOT NULL,
  "celk_trzba" numeric(14, 2) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "pok" varchar(39),
  "test" boolean,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" varchar(64),
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "transaction_id" varchar(64),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_attempt_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "eet_records" DROP CONSTRAINT IF EXISTS "eet_records_kind_check";
--> statement-breakpoint
ALTER TABLE "eet_records" ADD CONSTRAINT "eet_records_kind_check" CHECK ("kind" IN ('sale', 'refund'));
--> statement-breakpoint
ALTER TABLE "eet_records" DROP CONSTRAINT IF EXISTS "eet_records_status_check";
--> statement-breakpoint
ALTER TABLE "eet_records" ADD CONSTRAINT "eet_records_status_check" CHECK ("status" IN ('pending', 'confirmed', 'rejected', 'overdue'));
--> statement-breakpoint
ALTER TABLE "eet_records" DROP CONSTRAINT IF EXISTS "eet_records_environment_check";
--> statement-breakpoint
ALTER TABLE "eet_records" ADD CONSTRAINT "eet_records_environment_check" CHECK ("environment" IN ('playground', 'production'));
--> statement-breakpoint
-- Pořadové číslo is unique per pokladna (§ 6 odst. 1 písm. d)).
CREATE UNIQUE INDEX IF NOT EXISTS "eet_records_porad_cis_uniq" ON "eet_records" ("tenant_id", "id_pokl", "porad_cis");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eet_records_pending_idx" ON "eet_records" ("tenant_id", "created_at") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eet_records_invoice_idx" ON "eet_records" ("invoice_id");
--> statement-breakpoint
ALTER TABLE "eet_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "eet_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "eet_records";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "eet_records"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "eet_records" TO faktur_app;
    REVOKE DELETE ON "eet_records" FROM faktur_app;
  END IF;
END $$;
--> statement-breakpoint
-- EetCron opens a tenant transaction only for companies with unanswered
-- records, instead of every company every 5 minutes. Same shape as
-- list_tenant_ids(): ids only, demo companies left out.
CREATE OR REPLACE FUNCTION list_eet_pending_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT r.tenant_id FROM eet_records r JOIN tenants t ON t.id = r.tenant_id
  WHERE r.status IN ('pending', 'overdue') AND NOT t.is_demo;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_eet_pending_tenant_ids() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION list_eet_pending_tenant_ids() TO faktur_app;
  END IF;
END $$;
