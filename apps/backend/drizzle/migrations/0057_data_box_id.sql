-- ID datové schránky of the company (Settings → Company). Not a secret: it
-- is the public address of the box, printed on letters and listed in the
-- ISDS search. The yearly filings prefill it into the přehled for ČSSZ
-- (<idds>), so it no longer has to be typed for every download. Seven
-- characters [a-z0-9] (vyhláška č. 194/2009 Sb. about ISDS identifiers).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "data_box_id" varchar(7);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_data_box_id_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_data_box_id_check"
      CHECK ("data_box_id" IS NULL OR "data_box_id" ~ '^[a-z0-9]{7}$');
  END IF;
END $$;
