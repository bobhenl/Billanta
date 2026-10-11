ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "payment_methods" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_method_label" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_instructions" text;
