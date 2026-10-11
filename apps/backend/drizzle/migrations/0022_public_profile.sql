ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "public_profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_public_profile_slug_idx" ON "tenants" (lower("public_profile"->>'slug')) WHERE "public_profile"->>'slug' IS NOT NULL;
