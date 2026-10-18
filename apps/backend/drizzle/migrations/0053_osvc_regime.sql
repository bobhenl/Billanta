-- Two OSVČ answers in Settings → Měsíční zálohy: "Jste v paušálním režimu?"
-- and "Hlavní nebo vedlejší činnost?". They decide which statutory minimums
-- the "Použít" button fills (paušál only, or social + health with the right
-- minimum) and which deadlines the dashboard watches by default. Null = not
-- answered yet; existing rows stay null, so nothing is guessed for them.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "flat_tax_regime" boolean;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "activity_kind" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_activity_kind_check') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_activity_kind_check"
      CHECK ("activity_kind" IS NULL OR "activity_kind" IN ('main', 'secondary'));
  END IF;
END $$;
