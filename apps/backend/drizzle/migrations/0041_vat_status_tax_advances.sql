-- VAT status of the company: plátce, identifikovaná osoba (§6g–6l ZDPH /
-- SK §7a ZoDPH) or neplátce. The old dic_vat_payer flag stays for the code
-- and SQL functions that read it, kept equal to vat_status = 'payer' by the
-- CHECK below (TenantsService writes both). Existing tenants: true → payer,
-- false → non_payer. Invoices are not touched.
DO $$ BEGIN
 CREATE TYPE "public"."vat_status" AS ENUM('payer', 'identified', 'non_payer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "vat_status" "vat_status" DEFAULT 'non_payer' NOT NULL;
--> statement-breakpoint
UPDATE "tenants" SET "vat_status" = CASE WHEN "dic_vat_payer" THEN 'payer'::"vat_status" ELSE 'non_payer'::"vat_status" END;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenants" ADD CONSTRAINT "tenants_vat_status_payer_check" CHECK ("dic_vat_payer" = ("vat_status" = 'payer'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- OSVČ monthly advances ({ "social": 5720, "health": 3306, "flat_tax": … }),
-- shown next to the dashboard tax deadlines.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tax_advances" jsonb DEFAULT '{}'::jsonb NOT NULL;
