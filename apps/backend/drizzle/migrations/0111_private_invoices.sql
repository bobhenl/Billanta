-- Private invoices and a guard on who may change visibility.
-- An invoice marked is_private is seen only by the company owner and the
-- member who created it (member_visibility in rls-policies.sql); every
-- existing invoice starts as not private, so nothing changes until someone
-- marks one.
-- The trigger is the backstop behind the API checks: a member's scope, a
-- client's owner and privacy, and an invoice's privacy change only in the
-- owner's view ('full': the company owner, crons, API keys) or by the
-- record's own person (the client's owner, the invoice's creator). Admins
-- manage the team, so without it they could quietly widen what they see.
-- Nested calls are let through: ON DELETE SET NULL of a removed user runs
-- as a trigger of its own.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "is_private" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_visibility_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  me uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF pg_trigger_depth() > 1 OR app_view_mode() = 'full' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'contacts' THEN
    IF (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.is_private IS DISTINCT FROM OLD.is_private)
      AND OLD.owner_user_id IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'visibility_owner_only' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'invoices' THEN
    IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
      OR (NEW.is_private IS DISTINCT FROM OLD.is_private AND OLD.created_by_user_id IS DISTINCT FROM me) THEN
      RAISE EXCEPTION 'visibility_owner_only' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'tenant_memberships' THEN
    -- Making a member who sees only their own clients an admin would lift that too.
    IF NEW.contact_scope IS DISTINCT FROM OLD.contact_scope
      OR (OLD.contact_scope = 'own' AND NEW.role = 'admin' AND OLD.role IS DISTINCT FROM 'admin') THEN
      RAISE EXCEPTION 'visibility_owner_only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "contacts_guard_visibility" ON "contacts";
--> statement-breakpoint
CREATE TRIGGER "contacts_guard_visibility" BEFORE UPDATE OF "owner_user_id", "is_private" ON "contacts" FOR EACH ROW EXECUTE FUNCTION guard_visibility_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "invoices_guard_visibility" ON "invoices";
--> statement-breakpoint
CREATE TRIGGER "invoices_guard_visibility" BEFORE UPDATE OF "is_private", "created_by_user_id" ON "invoices" FOR EACH ROW EXECUTE FUNCTION guard_visibility_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenant_memberships_guard_visibility" ON "tenant_memberships";
--> statement-breakpoint
CREATE TRIGGER "tenant_memberships_guard_visibility" BEFORE UPDATE OF "contact_scope", "role" ON "tenant_memberships" FOR EACH ROW EXECUTE FUNCTION guard_visibility_change();
