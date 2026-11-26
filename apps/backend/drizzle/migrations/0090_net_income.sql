-- Report "Po zdanění" (net income after tax and insurance): the company's own
-- tax model (flat-rate expenses, rates, partners and their shares) and an
-- optional per-invoice split between partners. Both nullable: null means the
-- defaults, so existing rows need no backfill. Tenant-scoped tables already
-- have RLS; no new policy is needed for new columns.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tax_model" jsonb;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "partner_shares" jsonb;
