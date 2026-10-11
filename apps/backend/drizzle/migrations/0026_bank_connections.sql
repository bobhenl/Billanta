ALTER TYPE "bank_statement_source" ADD VALUE IF NOT EXISTS 'fio';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'fio',
  "label" text,
  "token_encrypted" text NOT NULL,
  "account_number" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "bank_connections_provider_check" CHECK ("provider" IN ('fio'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_connections_tenant_idx" ON "bank_connections" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_transactions_tenant_external_id_uniq"
  ON "bank_transactions" ("tenant_id", "external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bank_connections";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_connections"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_connections" TO faktur_app;
  END IF;
END $$;
