-- Classroom phase 2 (docs/classroom-mode-plan.md §8): teams, companies
-- beyond a student's home company, and students as accountants of other
-- companies of the class.
--
-- The home company of 0080 stays as it is (classroom_students.tenant_id).
-- An extra company is created like it: a demo tenant of the class that
-- expires with it, so classroom_extend, the read-only month after the end
-- and classroom_delete_class cover it unchanged. Memberships change only
-- through the functions here (classroom_memberships_lock refuses the app).
-- Triggers rather than new versions of the 0080 functions keep removing a
-- student and adding a co-teacher in step with the new companies.
CREATE TABLE IF NOT EXISTS "classroom_teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "class_id" uuid NOT NULL REFERENCES "classroom_classes"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_teams_class_name_unique" ON "classroom_teams" ("class_id", lower("name"));
--> statement-breakpoint
-- One team per student; class_id is there for the class page's one query.
CREATE TABLE IF NOT EXISTS "classroom_team_members" (
  "student_id" uuid PRIMARY KEY NOT NULL REFERENCES "classroom_students"("id") ON DELETE CASCADE,
  "team_id" uuid NOT NULL REFERENCES "classroom_teams"("id") ON DELETE CASCADE,
  "class_id" uuid NOT NULL REFERENCES "classroom_classes"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classroom_team_members_team_idx" ON "classroom_team_members" ("team_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classroom_companies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "class_id" uuid NOT NULL REFERENCES "classroom_classes"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "label" text,
  "student_id" uuid REFERENCES "classroom_students"("id") ON DELETE CASCADE,
  "team_id" uuid REFERENCES "classroom_teams"("id") ON DELETE CASCADE,
  "seeded_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "classroom_companies_one_owner" CHECK (num_nonnulls("student_id", "team_id") = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_companies_tenant_unique" ON "classroom_companies" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classroom_companies_class_idx" ON "classroom_companies" ("class_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classroom_accountants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "class_id" uuid NOT NULL REFERENCES "classroom_classes"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "student_id" uuid NOT NULL REFERENCES "classroom_students"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "classroom_accountants_mode" CHECK ("mode" IN ('review', 'bookkeeper', 'full'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_accountants_tenant_student_unique" ON "classroom_accountants" ("tenant_id", "student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classroom_accountants_class_idx" ON "classroom_accountants" ("class_id");
--> statement-breakpoint
-- Whether a class still takes changes: running, its owner approved, its
-- school not suspended.
CREATE OR REPLACE FUNCTION classroom_class_open(p_class_id uuid)
RETURNS classroom_classes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class classroom_classes%ROWTYPE;
BEGIN
  SELECT * INTO v_class FROM classroom_classes c WHERE c.id = p_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'classroom_not_found';
  END IF;
  IF v_class.ends_at <= now()
     OR EXISTS (SELECT 1 FROM classroom_schools s WHERE s.id = v_class.school_id AND s.suspended_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM classroom_teachers t WHERE t.id = v_class.owner_teacher_id AND t.status = 'approved') THEN
    RAISE EXCEPTION 'classroom_closed';
  END IF;
  RETURN v_class;
END;
$$;
--> statement-breakpoint
-- A second company of a student or the company of a team. Returns the user
-- to seed it as (the student, or the team's first member).
CREATE OR REPLACE FUNCTION classroom_create_company(
  p_class_id uuid,
  p_student_id uuid,
  p_team_id uuid,
  p_kind text,
  p_label text,
  p_tenant jsonb,
  p_bank jsonb,
  p_modules jsonb
)
RETURNS TABLE (company_id uuid, tenant_id uuid, seed_user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_class classroom_classes%ROWTYPE;
  v_owners uuid[];
  v_tenant uuid;
  v_company uuid;
  v_bank jsonb;
  v_sort integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('classroom_join:' || p_class_id));
  v_class := classroom_class_open(p_class_id);
  IF NOT (p_kind = ANY (v_class.kinds)) THEN
    RAISE EXCEPTION 'classroom_invalid_kind';
  END IF;
  IF num_nonnulls(p_student_id, p_team_id) <> 1 THEN
    RAISE EXCEPTION 'classroom_not_found';
  END IF;
  IF p_student_id IS NOT NULL THEN
    SELECT array_agg(s.user_id) INTO v_owners FROM classroom_students s WHERE s.id = p_student_id AND s.class_id = p_class_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM classroom_teams t WHERE t.id = p_team_id AND t.class_id = p_class_id) THEN
      RAISE EXCEPTION 'classroom_not_found';
    END IF;
    SELECT array_agg(s.user_id ORDER BY m.created_at) INTO v_owners
    FROM classroom_team_members m JOIN classroom_students s ON s.id = m.student_id
    WHERE m.team_id = p_team_id;
    IF v_owners IS NULL THEN
      RAISE EXCEPTION 'classroom_team_empty';
    END IF;
  END IF;
  IF v_owners IS NULL THEN
    RAISE EXCEPTION 'classroom_not_found';
  END IF;
  IF (SELECT count(*) FROM classroom_companies c
      WHERE c.student_id IS NOT DISTINCT FROM p_student_id AND c.team_id IS NOT DISTINCT FROM p_team_id) >= 3
     OR (SELECT count(*) FROM classroom_companies c WHERE c.class_id = p_class_id) >= 2 * v_class.max_students THEN
    RAISE EXCEPTION 'classroom_company_limit';
  END IF;

  INSERT INTO tenants (
    company_name, legal_name, ico, dic, vat_status, dic_vat_payer, flat_tax_regime, activity_kind,
    address_street, address_city, address_postal_code, address_country, default_locale,
    email, phone, website, registry_note,
    bank_account_number, bank_account_bank_code, bank_account_iban, bank_account_swift,
    ai_mode, plan_enforced, is_demo, demo_kind, demo_expires_at, enabled_modules, classroom_class_id
  ) VALUES (
    p_tenant->>'company_name', p_tenant->>'legal_name', p_tenant->>'ico', p_tenant->>'dic',
    (p_tenant->>'vat_status')::vat_status, (p_tenant->>'vat_status') = 'payer',
    (p_tenant->>'flat_tax_regime')::boolean, p_tenant->>'activity_kind',
    p_tenant->>'address_street', p_tenant->>'address_city', p_tenant->>'address_postal_code',
    p_tenant->>'address_country', p_tenant->>'default_locale',
    p_tenant->>'email', p_tenant->>'phone', p_tenant->>'website', p_tenant->>'registry_note',
    p_tenant->>'bank_account_number', p_tenant->>'bank_account_bank_code',
    p_tenant->>'bank_account_iban', p_tenant->>'bank_account_swift',
    'off', false, true, p_kind, v_class.ends_at + interval '30 days', coalesce(p_modules, '{}'::jsonb), p_class_id
  )
  RETURNING id INTO v_tenant;

  INSERT INTO tenant_memberships (tenant_id, user_id, role)
  SELECT v_tenant, u, 'owner' FROM unnest(v_owners) AS u;
  -- The teachers look in as 0081 decides: approved, school not suspended.
  PERFORM classroom_sync_class(p_class_id);

  FOR v_bank IN SELECT * FROM jsonb_array_elements(coalesce(p_bank, '[]'::jsonb)) LOOP
    INSERT INTO tenant_bank_accounts (tenant_id, label, account_number, bank_code, iban, swift, currency, sort_order)
    VALUES (v_tenant, v_bank->>'label', v_bank->>'account_number', v_bank->>'bank_code',
            v_bank->>'iban', v_bank->>'swift', v_bank->>'currency', v_sort);
    v_sort := v_sort + 1;
  END LOOP;

  INSERT INTO classroom_companies (class_id, tenant_id, kind, label, student_id, team_id)
  VALUES (p_class_id, v_tenant, p_kind, nullif(p_label, ''), p_student_id, p_team_id)
  RETURNING id INTO v_company;

  RETURN QUERY SELECT v_company, v_tenant, v_owners[1];
END;
$$;
--> statement-breakpoint
-- delete_demo_tenant keeps the owners' users: they still have a home company.
CREATE OR REPLACE FUNCTION classroom_delete_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT c.tenant_id INTO v_tenant FROM classroom_companies c WHERE c.id = p_company_id;
  IF v_tenant IS NOT NULL THEN
    PERFORM delete_demo_tenant(v_tenant);
  END IF;
  DELETE FROM classroom_companies WHERE id = p_company_id;
END;
$$;
--> statement-breakpoint
-- Adds a student to a team (and as an owner to its companies) or takes them
-- out. Being in the team replaces being the accountant of its company.
CREATE OR REPLACE FUNCTION classroom_team_member(p_team_id uuid, p_student_id uuid, p_add boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class uuid;
  v_user uuid;
  v_current uuid;
BEGIN
  SELECT t.class_id INTO v_class FROM classroom_teams t WHERE t.id = p_team_id;
  SELECT s.user_id INTO v_user FROM classroom_students s WHERE s.id = p_student_id AND s.class_id = v_class;
  IF v_class IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'classroom_not_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('classroom_join:' || v_class));
  SELECT m.team_id INTO v_current FROM classroom_team_members m WHERE m.student_id = p_student_id;

  IF p_add THEN
    IF v_current = p_team_id THEN
      RETURN;
    END IF;
    IF v_current IS NOT NULL THEN
      RAISE EXCEPTION 'classroom_team_taken';
    END IF;
    IF (SELECT count(*) FROM classroom_team_members m WHERE m.team_id = p_team_id) >= 6 THEN
      RAISE EXCEPTION 'classroom_team_full';
    END IF;
    INSERT INTO classroom_team_members (student_id, team_id, class_id) VALUES (p_student_id, p_team_id, v_class);
    DELETE FROM classroom_accountants a
    USING classroom_companies c
    WHERE c.team_id = p_team_id AND a.tenant_id = c.tenant_id AND a.student_id = p_student_id;
    INSERT INTO tenant_memberships (tenant_id, user_id, role)
    SELECT c.tenant_id, v_user, 'owner' FROM classroom_companies c WHERE c.team_id = p_team_id
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner', permissions = NULL;
  ELSIF v_current = p_team_id THEN
    DELETE FROM classroom_team_members WHERE student_id = p_student_id;
    DELETE FROM tenant_memberships tm
    USING classroom_companies c
    WHERE c.team_id = p_team_id AND tm.tenant_id = c.tenant_id AND tm.user_id = v_user;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION classroom_delete_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM delete_demo_tenant(c.tenant_id) FROM classroom_companies c WHERE c.team_id = p_team_id;
  DELETE FROM classroom_teams WHERE id = p_team_id;
END;
$$;
--> statement-breakpoint
-- A student becomes the accountant of another company of the class, or a
-- new mode replaces the old one. The permissions come from the mode
-- (src/classroom/accountants.ts): the accountant role writes everywhere,
-- most exercises need it to write less.
CREATE OR REPLACE FUNCTION classroom_assign_accountant(
  p_class_id uuid,
  p_tenant_id uuid,
  p_student_id uuid,
  p_mode text,
  p_permissions jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_link uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('classroom_join:' || p_class_id));
  PERFORM classroom_class_open(p_class_id);
  SELECT s.user_id INTO v_user FROM classroom_students s WHERE s.id = p_student_id AND s.class_id = p_class_id;
  IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant_id AND t.classroom_class_id = p_class_id) THEN
    RAISE EXCEPTION 'classroom_not_found';
  END IF;

  SELECT a.id INTO v_link FROM classroom_accountants a WHERE a.tenant_id = p_tenant_id AND a.student_id = p_student_id;
  IF v_link IS NOT NULL THEN
    UPDATE classroom_accountants SET mode = p_mode WHERE id = v_link;
    UPDATE tenant_memberships SET permissions = p_permissions
    WHERE tenant_id = p_tenant_id AND user_id = v_user AND role = 'accountant';
    RETURN v_link;
  END IF;

  IF EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = v_user) THEN
    RAISE EXCEPTION 'classroom_accountant_member';
  END IF;
  IF (SELECT count(*) FROM classroom_accountants a WHERE a.tenant_id = p_tenant_id) >= 3 THEN
    RAISE EXCEPTION 'classroom_accountant_limit';
  END IF;
  INSERT INTO classroom_accountants (class_id, tenant_id, student_id, mode)
  VALUES (p_class_id, p_tenant_id, p_student_id, p_mode)
  RETURNING id INTO v_link;
  INSERT INTO tenant_memberships (tenant_id, user_id, role, permissions)
  VALUES (p_tenant_id, v_user, 'accountant', p_permissions);
  RETURN v_link;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION classroom_unassign_accountant(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM tenant_memberships tm
  USING classroom_accountants a, classroom_students s
  WHERE a.id = p_link_id AND s.id = a.student_id
    AND tm.tenant_id = a.tenant_id AND tm.user_id = s.user_id AND tm.role = 'accountant';
  DELETE FROM classroom_accountants WHERE id = p_link_id;
END;
$$;
--> statement-breakpoint
-- What the classroom banner says inside a practice company: whose it is and
-- what p_user is there. Nothing unless p_user is a member.
CREATE OR REPLACE FUNCTION classroom_company_context(p_tenant_id uuid, p_user_id uuid)
RETURNS TABLE (
  class_id uuid,
  class_name text,
  join_code text,
  language text,
  ends_at timestamptz,
  company text,
  label text,
  owner_nickname text,
  team_name text,
  relation text,
  mode text,
  reentry_code_encrypted text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cl.id, cl.name, cl.join_code, cl.language, cl.ends_at,
    CASE WHEN home.id IS NOT NULL THEN 'home' WHEN co.team_id IS NOT NULL THEN 'team' ELSE 'second' END,
    co.label,
    coalesce(home.nickname, owner.nickname),
    team.name,
    CASE
      WHEN acc.id IS NOT NULL THEN 'accountant'
      WHEN me.id IS NOT NULL AND tm.role = 'owner' THEN 'owner'
      ELSE 'teacher'
    END,
    acc.mode,
    me.reentry_code_encrypted
  FROM tenant_memberships tm
  JOIN tenants t ON t.id = tm.tenant_id
  JOIN classroom_classes cl ON cl.id = t.classroom_class_id
  LEFT JOIN classroom_students home ON home.tenant_id = t.id
  LEFT JOIN classroom_companies co ON co.tenant_id = t.id
  LEFT JOIN classroom_students owner ON owner.id = co.student_id
  LEFT JOIN classroom_teams team ON team.id = co.team_id
  LEFT JOIN classroom_students me ON me.user_id = tm.user_id AND me.class_id = cl.id
  LEFT JOIN classroom_accountants acc ON acc.tenant_id = t.id AND acc.student_id = me.id
  WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_user_id;
$$;
--> statement-breakpoint
-- Removing a student (classroom_remove_student, a class going away, the
-- user's deletion) also removes their second companies and their places in
-- team and client companies. delete_demo_tenant has kept the student's user
-- while those memberships existed; the AFTER trigger deletes it once none
-- are left (deleting it here would delete this very row a second time).
CREATE OR REPLACE FUNCTION classroom_student_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_WHEN = 'BEFORE' THEN
    DELETE FROM tenant_memberships tm
    USING tenants t
    WHERE tm.user_id = OLD.user_id AND t.id = tm.tenant_id
      AND t.classroom_class_id = OLD.class_id AND t.id <> OLD.tenant_id;
    PERFORM delete_demo_tenant(c.tenant_id) FROM classroom_companies c WHERE c.student_id = OLD.id;
    RETURN OLD;
  END IF;
  DELETE FROM users u
  WHERE u.id = OLD.user_id AND u.is_demo
    AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS classroom_student_cleanup_before ON classroom_students;
--> statement-breakpoint
CREATE TRIGGER classroom_student_cleanup_before BEFORE DELETE ON classroom_students
  FOR EACH ROW EXECUTE FUNCTION classroom_student_cleanup();
--> statement-breakpoint
DROP TRIGGER IF EXISTS classroom_student_cleanup_after ON classroom_students;
--> statement-breakpoint
CREATE TRIGGER classroom_student_cleanup_after AFTER DELETE ON classroom_students
  FOR EACH ROW EXECUTE FUNCTION classroom_student_cleanup();
--> statement-breakpoint
-- classroom_add_teacher adds the viewers through classroom_sync_class (0081),
-- which covers every company of the class; classroom_remove_teacher (0080)
-- only knows the home companies, so this takes the teacher out of the others.
CREATE OR REPLACE FUNCTION classroom_class_teachers_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM tenant_memberships m
  USING classroom_companies c, classroom_teachers t
  WHERE c.class_id = OLD.class_id AND t.id = OLD.teacher_id
    AND m.tenant_id = c.tenant_id AND m.user_id = t.user_id AND m.role = 'viewer';
  RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS classroom_class_teachers_sync ON classroom_class_teachers;
--> statement-breakpoint
CREATE TRIGGER classroom_class_teachers_sync AFTER DELETE ON classroom_class_teachers
  FOR EACH ROW EXECUTE FUNCTION classroom_class_teachers_sync();
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_class_open(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_create_company(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_delete_company(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_team_member(uuid, uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_delete_team(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_assign_accountant(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_unassign_accountant(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_company_context(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_student_cleanup() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_class_teachers_sync() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION classroom_create_company(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_delete_company(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_team_member(uuid, uuid, boolean) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_delete_team(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_assign_accountant(uuid, uuid, uuid, text, jsonb) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_unassign_accountant(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_company_context(uuid, uuid) TO faktur_app;
    -- Teams are named and renamed by the app; who is in them, which
    -- companies exist and who keeps whose books change through the
    -- functions above, which keep the memberships in step.
    GRANT SELECT, INSERT, UPDATE ON classroom_teams TO faktur_app;
    REVOKE DELETE ON classroom_teams FROM faktur_app;
    GRANT SELECT ON classroom_team_members, classroom_companies, classroom_accountants TO faktur_app;
    REVOKE INSERT, UPDATE, DELETE ON classroom_team_members, classroom_companies, classroom_accountants FROM faktur_app;
    GRANT UPDATE (label, seeded_at) ON classroom_companies TO faktur_app;
  END IF;
END $$;
