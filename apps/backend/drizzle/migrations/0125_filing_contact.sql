-- E-mail and phone for VetaP of the EPO filings, when the person does not
-- want them printed on invoices (tenants.email/phone are). Nullable: empty
-- falls back to the invoice contact. RLS on tenants needs no change.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "filing_email" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "filing_phone" varchar(32);
