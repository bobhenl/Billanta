-- Slovak companies keep their books in EUR, so their documents' exchange
-- rate is EUR per unit at the ECB rate (§ 26 zákona č. 222/2004 Z. z.),
-- stored as mode 'ecb_daily'. EUR per unit of a weak currency (HUF, JPY)
-- needs more than six decimals, hence the wider scale.
--
-- Until now every rate was CZK per unit, which for a Slovak company is
-- wrong: EUR documents got a CZK conversion and other currencies a CZK
-- rate. Those rates are cleared; reports look the right rate up when it is
-- missing, and an EUR document needs none.
ALTER TABLE "invoices" ALTER COLUMN "exchange_rate" TYPE numeric(20, 10);
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "exchange_rate" TYPE numeric(20, 10);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_exchange_rate_mode_check";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_exchange_rate_mode_check"
  CHECK ("exchange_rate_mode" IS NULL OR "exchange_rate_mode" IN ('cnb_daily', 'ecb_daily', 'annual', 'manual', 'none'));
--> statement-breakpoint
UPDATE "invoices" SET "exchange_rate" = NULL, "exchange_rate_mode" = NULL, "exchange_rate_date" = NULL
  WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "address_country" = 'SK')
    AND ("exchange_rate" IS NOT NULL OR "exchange_rate_mode" IS NOT NULL);
--> statement-breakpoint
UPDATE "expenses" SET "exchange_rate" = NULL
  WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "address_country" = 'SK')
    AND "exchange_rate" IS NOT NULL;
