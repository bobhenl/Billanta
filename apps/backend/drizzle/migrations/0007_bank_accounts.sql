CREATE TABLE IF NOT EXISTS "tenant_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"account_number" text,
	"bank_code" varchar(4),
	"iban" text,
	"swift" varchar(11),
	"currency" varchar(3),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_bank_accounts" ADD CONSTRAINT "tenant_bank_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bank_account_id_tenant_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."tenant_bank_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
