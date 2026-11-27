-- E-mail reminders before a VAT filing deadline (src/exports/vat-filing-reminders.cron.ts).
-- The daily cron writes a row once it has reminded a company of a deadline
-- kind for a tax period at a stage ('ahead' a few days before, 'due_day'),
-- and skips what is already here, so a restarted run never mails twice.
-- Insert-only for the app (app-role-grants.sql); rows go with the tenant.
CREATE TABLE IF NOT EXISTS "vat_filing_reminders" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "kind" varchar(32) NOT NULL,
  "period" varchar(7) NOT NULL,
  "stage" varchar(16) NOT NULL,
  "due_date" date NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vat_filing_reminders_pk" PRIMARY KEY ("tenant_id", "kind", "period", "stage")
);
--> statement-breakpoint
ALTER TABLE "vat_filing_reminders" DROP CONSTRAINT IF EXISTS "vat_filing_reminders_stage_check";
--> statement-breakpoint
ALTER TABLE "vat_filing_reminders" ADD CONSTRAINT "vat_filing_reminders_stage_check" CHECK ("stage" IN ('ahead', 'due_day'));
--> statement-breakpoint
ALTER TABLE "vat_filing_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vat_filing_reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "vat_filing_reminders";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "vat_filing_reminders"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
