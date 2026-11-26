-- Per-member visibility of clients. A member set to contact_scope = 'own'
-- sees only the contacts assigned to them (owner_user_id) and the
-- documents of those contacts or created by themselves; a contact marked
-- is_private is hidden from everyone but its owner and the company owner.
-- The rules live in RESTRICTIVE policies in rls-policies.sql (app_view_mode).
-- The user columns default to app.current_user_id, so every code path that
-- inserts as a signed-in user records who did it without being changed;
-- crons, API keys and the AI service leave them null.
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "contact_scope" varchar(8) NOT NULL DEFAULT 'all';
--> statement-breakpoint
ALTER TABLE "tenant_memberships" DROP CONSTRAINT IF EXISTS "tenant_memberships_contact_scope_check";
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_contact_scope_check" CHECK ("contact_scope" IN ('all', 'own'));
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "owner_user_id" uuid DEFAULT nullif(current_setting('app.current_user_id', true), '')::uuid;
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_owner_user_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "is_private" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid DEFAULT nullif(current_setting('app.current_user_id', true), '')::uuid;
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid DEFAULT nullif(current_setting('app.current_user_id', true), '')::uuid;
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
