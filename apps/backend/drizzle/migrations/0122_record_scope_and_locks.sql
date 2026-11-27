-- Per-area record scope and per-record access locks.
--
-- Scope: contact_scope (0100) gets a sibling for invoices and expenses, and
-- all three take 'all' | 'edit_own' | 'own'. 'edit_own' sees what 'all'
-- sees but may change only its own records (created by the member, or of a
-- client assigned to them). A member limited to their own clients was also
-- limited to their documents, so 'own' carries over to the new columns and
-- nobody sees more after this migration than before it.
--
-- Lock: access_lock replaces is_private (0100, 0111) on contacts and
-- invoices and is new on expenses. 'private' = only the lock holder and the
-- company owner, 'admin' = also admins, 'accountant' = everyone but
-- viewers. The holder always keeps access and the company owner always sees
-- everything, so nobody locks the owner out. Existing private records
-- become 'private' locks held by the person who could see them.
--
-- The policies and functions are created here too, not only in
-- rls-policies.sql, because the old policies read is_private: dropping the
-- column without them in place would leave the tables open until that file
-- runs. rls-policies.sql repeats them (it is re-run after every migrate).
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "invoice_scope" varchar(8) NOT NULL DEFAULT 'all';
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN IF NOT EXISTS "expense_scope" varchar(8) NOT NULL DEFAULT 'all';
--> statement-breakpoint
ALTER TABLE "tenant_memberships" DROP CONSTRAINT IF EXISTS "tenant_memberships_contact_scope_check";
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_contact_scope_check" CHECK ("contact_scope" IN ('all', 'edit_own', 'own'));
--> statement-breakpoint
ALTER TABLE "tenant_memberships" DROP CONSTRAINT IF EXISTS "tenant_memberships_invoice_scope_check";
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_invoice_scope_check" CHECK ("invoice_scope" IN ('all', 'edit_own', 'own'));
--> statement-breakpoint
ALTER TABLE "tenant_memberships" DROP CONSTRAINT IF EXISTS "tenant_memberships_expense_scope_check";
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_expense_scope_check" CHECK ("expense_scope" IN ('all', 'edit_own', 'own'));
--> statement-breakpoint
-- No app.current_user_id here, so the 0111 trigger lets this through.
UPDATE "tenant_memberships" SET "invoice_scope" = 'own', "expense_scope" = 'own' WHERE "contact_scope" = 'own' AND "invoice_scope" = 'all' AND "expense_scope" = 'all';
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "access_lock" varchar(12);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "access_lock_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "access_lock" varchar(12);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "access_lock_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "access_lock" varchar(12);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "access_lock_user_id" uuid;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'invoices', 'expenses'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_access_lock_check');
    -- A holder only with a lock; a lock may outlive its holder (ON DELETE SET NULL), then only the owner sees it.
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((access_lock IS NULL OR access_lock IN (''private'', ''admin'', ''accountant'')) AND (access_lock IS NOT NULL OR access_lock_user_id IS NULL))', t, t || '_access_lock_check');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_access_lock_user_id_fk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (access_lock_user_id) REFERENCES users(id) ON DELETE SET NULL', t, t || '_access_lock_user_id_fk');
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'is_private') THEN
    UPDATE contacts SET access_lock = 'private', access_lock_user_id = owner_user_id WHERE is_private AND access_lock IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'is_private') THEN
    UPDATE invoices SET access_lock = 'private', access_lock_user_id = created_by_user_id WHERE is_private AND access_lock IS NULL;
  END IF;
END $$;
--> statement-breakpoint
-- The old triggers and policies name is_private; they come back below in their new form.
DROP TRIGGER IF EXISTS "contacts_guard_visibility" ON "contacts";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "invoices_guard_visibility" ON "invoices";
--> statement-breakpoint
DROP POLICY IF EXISTS member_visibility ON contacts;
--> statement-breakpoint
DROP POLICY IF EXISTS member_visibility ON invoices;
--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "is_private";
--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "is_private";
--> statement-breakpoint
-- Index for the lock check of the few locked rows.
CREATE INDEX IF NOT EXISTS "invoices_access_lock_idx" ON "invoices" ("tenant_id") WHERE "access_lock" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_access_lock_idx" ON "expenses" ("tenant_id") WHERE "access_lock" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_access_lock_idx" ON "contacts" ("tenant_id") WHERE "access_lock" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_member_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role FROM tenant_memberships m
  WHERE m.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
    AND m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_scope(p_area text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN m.role = 'owner' THEN 'full'
      WHEN m.role = 'admin' THEN 'all'
      ELSE CASE p_area WHEN 'contacts' THEN m.contact_scope WHEN 'invoices' THEN m.invoice_scope WHEN 'expenses' THEN m.expense_scope ELSE 'all' END
    END
    FROM tenant_memberships m
    WHERE m.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
      AND m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  ), 'full');
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_view_mode()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN m.role = 'owner' THEN 'full'
      WHEN m.role = 'admin' THEN 'all'
      WHEN 'own' IN (m.contact_scope, m.invoice_scope, m.expense_scope) THEN 'own'
      ELSE 'all'
    END
    FROM tenant_memberships m
    WHERE m.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
      AND m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  ), 'full');
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_lock_allows(p_lock text, p_holder uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_lock IS NULL
    OR coalesce(p_holder = nullif(current_setting('app.current_user_id', true), '')::uuid, false)
    OR (p_lock = 'admin' AND app_member_role() = 'admin')
    OR (p_lock = 'accountant' AND app_member_role() IN ('admin', 'accountant'));
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_owns_document(p_creator uuid, p_contact uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(p_creator = nullif(current_setting('app.current_user_id', true), '')::uuid, false)
    OR (p_contact IS NOT NULL AND EXISTS (
      SELECT 1 FROM contacts c WHERE c.id = p_contact AND c.owner_user_id = nullif(current_setting('app.current_user_id', true), '')::uuid));
$$;
--> statement-breakpoint
CREATE POLICY member_visibility ON contacts AS RESTRICTIVE
  USING (CASE (SELECT app_scope('contacts'))
    WHEN 'full' THEN true
    WHEN 'own' THEN app_lock_allows(access_lock, access_lock_user_id)
      AND coalesce(owner_user_id = nullif(current_setting('app.current_user_id', true), '')::uuid, false)
    ELSE app_lock_allows(access_lock, access_lock_user_id)
  END);
--> statement-breakpoint
CREATE POLICY member_visibility ON invoices AS RESTRICTIVE
  USING (CASE (SELECT app_scope('invoices'))
    WHEN 'full' THEN true
    WHEN 'own' THEN app_lock_allows(access_lock, access_lock_user_id) AND app_owns_document(created_by_user_id, contact_id)
    ELSE app_lock_allows(access_lock, access_lock_user_id) AND (
      coalesce(created_by_user_id = nullif(current_setting('app.current_user_id', true), '')::uuid, false)
      OR contact_id IS NULL
      OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = invoices.contact_id))
  END);
--> statement-breakpoint
DROP POLICY IF EXISTS member_visibility ON expenses;
--> statement-breakpoint
CREATE POLICY member_visibility ON expenses AS RESTRICTIVE
  USING (CASE (SELECT app_scope('expenses'))
    WHEN 'full' THEN true
    WHEN 'own' THEN app_lock_allows(access_lock, access_lock_user_id) AND app_owns_document(created_by_user_id, supplier_contact_id)
    ELSE app_lock_allows(access_lock, access_lock_user_id) AND (
      coalesce(created_by_user_id = nullif(current_setting('app.current_user_id', true), '')::uuid, false)
      OR supplier_contact_id IS NULL
      OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = expenses.supplier_contact_id))
  END);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_visibility_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  me uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  person uuid;
BEGIN
  IF pg_trigger_depth() > 1 OR app_view_mode() = 'full' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'tenant_memberships' THEN
    -- Making a limited member an admin would lift the limit too.
    IF NEW.contact_scope IS DISTINCT FROM OLD.contact_scope
      OR NEW.invoice_scope IS DISTINCT FROM OLD.invoice_scope
      OR NEW.expense_scope IS DISTINCT FROM OLD.expense_scope
      OR (NEW.role = 'admin' AND OLD.role IS DISTINCT FROM 'admin'
        AND (OLD.contact_scope <> 'all' OR OLD.invoice_scope <> 'all' OR OLD.expense_scope <> 'all')) THEN
      RAISE EXCEPTION 'visibility_owner_only' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'contacts' THEN
    person := OLD.owner_user_id;
    -- A locked client is handed over only by the company owner, with its lock.
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
      AND (person IS DISTINCT FROM me OR OLD.access_lock IS NOT NULL) THEN
      RAISE EXCEPTION 'visibility_owner_only' USING ERRCODE = '42501';
    END IF;
  ELSE
    person := OLD.created_by_user_id;
    IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
      RAISE EXCEPTION 'visibility_owner_only' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.access_lock IS DISTINCT FROM OLD.access_lock OR NEW.access_lock_user_id IS DISTINCT FROM OLD.access_lock_user_id THEN
    -- A lock is its holder's to change; a new one is held by whoever sets it;
    -- an unlocked record is locked by its own person or an admin.
    IF (OLD.access_lock IS NOT NULL AND OLD.access_lock_user_id IS DISTINCT FROM me)
      OR (NEW.access_lock IS NOT NULL AND NEW.access_lock_user_id IS DISTINCT FROM me)
      OR (OLD.access_lock IS NULL AND person IS DISTINCT FROM me AND app_member_role() IS DISTINCT FROM 'admin') THEN
      RAISE EXCEPTION 'visibility_owner_only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "contacts_guard_visibility" BEFORE UPDATE OF "owner_user_id", "access_lock", "access_lock_user_id" ON "contacts" FOR EACH ROW EXECUTE FUNCTION guard_visibility_change();
--> statement-breakpoint
CREATE TRIGGER "invoices_guard_visibility" BEFORE UPDATE OF "created_by_user_id", "access_lock", "access_lock_user_id" ON "invoices" FOR EACH ROW EXECUTE FUNCTION guard_visibility_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "expenses_guard_visibility" ON "expenses";
--> statement-breakpoint
CREATE TRIGGER "expenses_guard_visibility" BEFORE UPDATE OF "created_by_user_id", "access_lock", "access_lock_user_id" ON "expenses" FOR EACH ROW EXECUTE FUNCTION guard_visibility_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenant_memberships_guard_visibility" ON "tenant_memberships";
--> statement-breakpoint
CREATE TRIGGER "tenant_memberships_guard_visibility" BEFORE UPDATE OF "contact_scope", "invoice_scope", "expense_scope", "role" ON "tenant_memberships" FOR EACH ROW EXECUTE FUNCTION guard_visibility_change();
