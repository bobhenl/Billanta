-- Kurz pro cizí měny (Settings → Faktury): how a foreign-currency document
-- converts to CZK, stored on the document at issue so a later change of the
-- setting never rewrites it. Existing rows stay null = issued before the
-- setting existed, printed exactly as before. No data is changed.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "exchange_rate_mode" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "exchange_rate_date" date;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_exchange_rate_mode_check') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_exchange_rate_mode_check"
      CHECK ("exchange_rate_mode" IS NULL OR "exchange_rate_mode" IN ('cnb_daily', 'annual', 'manual', 'none'));
  END IF;
END $$;
