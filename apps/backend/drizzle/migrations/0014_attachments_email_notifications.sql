CREATE TABLE "invoice_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	"invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE cascade,
	"filename" varchar(200) NOT NULL,
	"mime" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" text NOT NULL,
	"send_with_email" boolean DEFAULT true NOT NULL,
	"show_in_portal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invoice_attachments_invoice_idx" ON "invoice_attachments" ("invoice_id");
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "email_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"kind" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"link" varchar(300),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("tenant_id", "user_id", "created_at");
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;
