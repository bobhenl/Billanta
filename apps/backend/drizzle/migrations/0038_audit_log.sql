-- Audit log (Settings → Historie změn, and per document): who changed what,
-- old → new per field, and an optional reason. Append-only: there is no
-- UPDATE or DELETE policy, so under FORCE RLS rows cannot be altered or
-- removed by the app role. The acting user comes from the request's
-- transaction (`app.current_user_id` / `app.current_actor`, set by the
-- tenant-context middlewares), so services only say what happened.
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL
    DEFAULT nullif(current_setting('app.current_user_id', true), '')::uuid,
  "actor" varchar(40) NOT NULL DEFAULT coalesce(nullif(current_setting('app.current_actor', true), ''), 'system'),
  "entity_type" varchar(40) NOT NULL,
  "entity_id" uuid,
  "entity_label" text,
  "action" varchar(40) NOT NULL,
  "changes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_tenant_created_idx" ON "audit_log" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" ("tenant_id", "entity_type", "entity_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS audit_log_read ON "audit_log";
--> statement-breakpoint
CREATE POLICY audit_log_read ON "audit_log" FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS audit_log_append ON "audit_log";
--> statement-breakpoint
CREATE POLICY audit_log_append ON "audit_log" FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT ON "audit_log" TO faktur_app;
  END IF;
END $$;
