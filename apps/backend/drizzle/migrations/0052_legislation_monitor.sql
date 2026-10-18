-- Legislation monitor: once a week the backend fetches the official pages
-- the tax constants come from (EPO form list, ČSSZ přehled schemas, minimum
-- advances, paušální daň) and keeps a hash of the relevant part. A change
-- creates a platform alert so staff review the constants; "no change"
-- moves the per-dataset "last checked" date the public guides print.
-- Global tables (no tenant_id): only the cron and platform admins use them.
CREATE TABLE IF NOT EXISTS "legislation_sources" (
  "key" varchar(40) PRIMARY KEY,
  "url" text NOT NULL,
  "hash" text,
  "excerpt" text,
  "status" varchar(16) NOT NULL DEFAULT 'new',
  "last_error" text,
  "last_checked_at" timestamp with time zone,
  "last_changed_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" varchar(40) NOT NULL,
  "source_key" varchar(40),
  "message" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_alerts_open_idx" ON "platform_alerts" ("created_at") WHERE "acknowledged_at" IS NULL;
