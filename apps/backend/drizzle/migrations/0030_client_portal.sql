-- Client portal (Invoice Ninja's client portal): one link per customer listing
-- all their issued documents. Null = portal off; rotating the token revokes old links.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "portal_token" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_portal_token_unique" ON "contacts" ("portal_token");
