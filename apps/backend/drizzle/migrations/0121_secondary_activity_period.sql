-- An OSVČ is often in vedlejší činnost only for part of a year (a student
-- until graduation, parental leave, a job that ends). Settings → Company
-- keeps the days of that period next to hlavní / vedlejší činnost, and the
-- "Po zdanění" report counts the months from them (the rozhodná částka drops
-- by a twelfth per month without secondary activity). Null = open-ended on
-- that side; both null with activity_kind 'secondary' = the whole time.
-- Covered by the existing tenants RLS policy and grants.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "secondary_activity_from" date;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "secondary_activity_to" date;
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_secondary_activity_period_check";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_secondary_activity_period_check"
  CHECK ("secondary_activity_from" IS NULL OR "secondary_activity_to" IS NULL OR "secondary_activity_from" <= "secondary_activity_to");
