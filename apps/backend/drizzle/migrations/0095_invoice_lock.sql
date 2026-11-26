-- An owner or admin can lock an invoice: its detail and documents then open
-- only after the viewer re-enters their password. The row stays in lists and
-- totals, so these are plain nullable columns with no effect on the rest.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "locked_by" uuid;
