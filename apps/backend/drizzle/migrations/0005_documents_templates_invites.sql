DO $$ BEGIN
 CREATE TYPE "public"."document_type" AS ENUM('invoice', 'proforma', 'credit_note', 'quote');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'cash', 'card', 'cash_on_delivery', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" varchar(16),
	"contact_id" uuid,
	"document_type" "document_type" DEFAULT 'invoice' NOT NULL,
	"currency" varchar(3) DEFAULT 'CZK' NOT NULL,
	"due_in_days" integer,
	"payment_method" "payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"note_above" text,
	"note_below" text,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "tenant_role" DEFAULT 'accountant' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "invoice_number_sequences_tenant_year_unique";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "document_number" varchar(64);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "variable_symbol" varchar(10);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "supplier_ico" varchar(8);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "unit" varchar(16);--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_number_sequences" ADD COLUMN "series" varchar(8) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "document_type" "document_type" DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "related_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "taxable_supply_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_method" "payment_method" DEFAULT 'bank_transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "constant_symbol" varchar(4);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "specific_symbol" varchar(10);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "order_number" varchar(64);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "note_above" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "note_below" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "internal_note" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "language" varchar(2) DEFAULT 'cs' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reverse_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "dashboard_tiles" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "registry_note" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "bank_account_swift" varchar(11);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_due_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_payment_method" "payment_method" DEFAULT 'bank_transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_note_below" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_invitations_token_hash_unique" ON "tenant_invitations" USING btree ("token_hash");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_related_invoice_id_invoices_id_fk" FOREIGN KEY ("related_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_number_sequences_tenant_series_year_unique" ON "invoice_number_sequences" USING btree ("tenant_id","series","year");