ALTER TABLE "invoices" ADD COLUMN "issue_place" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issued_by_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "code" varchar(32);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "invoice_form_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;
