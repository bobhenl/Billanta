-- Country as data (docs/expansion/architecture.md, phase 1).
--
--   * tenants.country: the tax country (VAT rules, deadlines, exports). Until
--     now it was read from address_country, so the backfill keeps that rule:
--     SK stays SK, everything else is CZ. From here on the two are separate:
--     the address stays freely editable, the country is chosen at onboarding
--     and locked after the first issued invoice (TenantsService).
--   * tenants.home_currency: the currency of the books, CZK / EUR today.
--   * ico / dic widened to 20 characters for foreign company and VAT ids.
--   * tax_ids jsonb on tenants and contacts for further ids (SK IČ DPH,
--     Steuernummer, REGON …) instead of more columns.
--
-- The CHECK only tests the ISO 3166 shape; which countries a company may
-- pick is ACTIVE_COUNTRIES in @faktur/cz-compliance, so opening a country
-- needs no migration. Tenants are also created by SQL functions (sign-up,
-- demo, classroom) that do not know the new columns: a BEFORE INSERT
-- trigger fills them from address_country, so those functions and the RLS
-- file stay as they are. That is why the columns have no default.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "country" char(2);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "home_currency" char(3);
--> statement-breakpoint
UPDATE "tenants" SET "country" = CASE WHEN upper("address_country") = 'SK' THEN 'SK' ELSE 'CZ' END WHERE "country" IS NULL;
--> statement-breakpoint
UPDATE "tenants" SET "home_currency" = CASE WHEN "country" = 'SK' THEN 'EUR' ELSE 'CZK' END WHERE "home_currency" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tenants_fill_country() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.country IS NULL THEN
    NEW.country := CASE WHEN upper(NEW.address_country) = 'SK' THEN 'SK' ELSE 'CZ' END;
  END IF;
  IF NEW.home_currency IS NULL THEN
    NEW.home_currency := CASE WHEN NEW.country = 'SK' THEN 'EUR' ELSE 'CZK' END;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenants_fill_country" ON "tenants";
--> statement-breakpoint
CREATE TRIGGER "tenants_fill_country" BEFORE INSERT ON "tenants" FOR EACH ROW EXECUTE FUNCTION tenants_fill_country();
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "country" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "home_currency" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_country_iso";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_country_iso" CHECK ("country" ~ '^[A-Z]{2}$');
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_home_currency_iso";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_home_currency_iso" CHECK ("home_currency" ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "ico" TYPE varchar(20);
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "dic" TYPE varchar(20);
--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "ico" TYPE varchar(20);
--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "dic" TYPE varchar(20);
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "supplier_ico" TYPE varchar(20);
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "supplier_dic" TYPE varchar(20);
--> statement-breakpoint
ALTER TABLE "ares_cache" ALTER COLUMN "ico" TYPE varchar(20);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tax_ids" jsonb NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "tax_ids" jsonb NOT NULL DEFAULT '{}';
