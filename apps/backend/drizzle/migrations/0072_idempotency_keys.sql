-- Idempotency keys for creates that a client may retry (docs/offline-drafts-plan.md):
-- the dashboard queues invoice and contact drafts written offline and sends
-- each with an Idempotency-Key, so a retry after a lost response returns the
-- row created the first time instead of a duplicate.
--
-- The key row is inserted first in the request's own transaction; the
-- primary key makes a parallel request with the same key wait for it.
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "key" varchar(100) NOT NULL,
  "scope" varchar(40) NOT NULL,
  "resource_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_idx" ON "idempotency_keys" ("tenant_id", "created_at");
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "idempotency_keys";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "idempotency_keys"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_keys" TO faktur_app;
  END IF;
END $$;
