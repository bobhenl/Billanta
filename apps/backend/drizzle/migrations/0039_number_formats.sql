-- Settings → Číslování dokladů: the company's own number pattern per
-- document type (`tenants.number_formats`, e.g. {"invoice": "{N}/{MM}/{YYYY}"}).
-- NULL or a missing type keeps the built-in `{series}{YYYY}-{NNNN}`.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "number_formats" jsonb;
--> statement-breakpoint
-- A pattern with {MM} counts per month: `month` 1–12 is a monthly counter,
-- 0 the yearly one (every existing row).
ALTER TABLE "invoice_number_sequences" ADD COLUMN IF NOT EXISTS "month" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoice_number_sequences" ADD CONSTRAINT "invoice_number_sequences_month_check" CHECK ("month" BETWEEN 0 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_number_sequences_tenant_series_year_month_unique" ON "invoice_number_sequences" USING btree ("tenant_id","series","year","month");
--> statement-breakpoint
DROP INDEX IF EXISTS "invoice_number_sequences_tenant_series_year_unique";
