ALTER TABLE "invoices" ADD COLUMN "client_response" varchar(16);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "client_responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "client_response_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "client_response_note" text;
