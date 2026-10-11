ALTER TABLE "invoices" ADD COLUMN "public_view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "public_first_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "public_last_viewed_at" timestamp with time zone;