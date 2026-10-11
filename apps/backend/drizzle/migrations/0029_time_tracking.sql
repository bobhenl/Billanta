-- Time tracking (Invoice Ninja's tasks/projects, Fakturoid's timer): projects
-- with an hourly rate, time entries (a running timer has no ended_at) and the
-- invoice an entry was billed on.
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "hourly_rate" numeric(14, 2),
  "currency" varchar(3) NOT NULL DEFAULT 'CZK',
  "color" varchar(16),
  "archived" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_tenant_idx" ON "projects" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "description" text NOT NULL DEFAULT '',
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "minutes" integer NOT NULL DEFAULT 0,
  "hourly_rate" numeric(14, 2),
  "billable" boolean NOT NULL DEFAULT true,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "time_entries_minutes_check" CHECK ("minutes" >= 0 AND "minutes" <= 100000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_tenant_started_idx" ON "time_entries" ("tenant_id", "started_at");
--> statement-breakpoint
-- At most one running timer per person.
CREATE UNIQUE INDEX IF NOT EXISTS "time_entries_running_uniq" ON "time_entries" ("tenant_id", "user_id") WHERE "ended_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "projects";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "projects"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "time_entries";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "time_entries"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "projects" TO faktur_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "time_entries" TO faktur_app;
  END IF;
END $$;
