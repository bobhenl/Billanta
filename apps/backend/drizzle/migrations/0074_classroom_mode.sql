-- Classroom mode (docs/classroom-mode-plan.md): an approved teacher opens a
-- class, students join with the class code and a nickname, and each gets a
-- practice company.
--
-- A practice company is a demo tenant (0068/0069) that belongs to a class
-- (tenants.classroom_class_id), so every demo safeguard holds: locked
-- identity, no e-mail, nothing outward-facing, row caps. On top of that:
--   - the class decides the modules, students can't switch them;
--   - the memberships (the student owns it, the class's teachers look in as
--     viewers) only change through the functions here;
--   - row caps are higher, a school year is longer than a demo day;
--   - the company lives until 30 days after the class ends (read-only for
--     those 30 days, see TenantContextMiddleware), then it is deleted.
--
-- Schools, teachers and classes are global tables like the partner
-- catalogue: the backend checks who may see what. classroom_students holds
-- the re-entry codes and links users to companies, so the app can read it
-- and change a code, but rows come and go only through the functions here.
CREATE TABLE IF NOT EXISTS "classroom_schools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "country" char(2) NOT NULL,
  "ico" varchar(12) NOT NULL,
  "name" text NOT NULL,
  "level" text NOT NULL,
  -- From the registry lookup, for staff to see it is a school.
  "legal_form" text,
  "address" text,
  "web_url" text,
  "email_domain" text,
  "verification" text DEFAULT 'pending' NOT NULL,
  "max_active_students" integer DEFAULT 2000 NOT NULL,
  -- Staff closed every class of the school.
  "suspended_at" timestamp with time zone,
  "review_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verified_at" timestamp with time zone,
  CONSTRAINT "classroom_schools_country_check" CHECK ("country" IN ('CZ', 'SK')),
  CONSTRAINT "classroom_schools_level_check" CHECK ("level" IN ('zs', 'ss', 'vos', 'vs', 'course')),
  CONSTRAINT "classroom_schools_verification_check" CHECK ("verification" IN ('pending', 'verified', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_schools_country_ico_unique" ON "classroom_schools" ("country", "ico");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classroom_teachers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "school_id" uuid NOT NULL REFERENCES "classroom_schools"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "subject" text,
  "expected_students" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "invited_by" uuid REFERENCES "classroom_teachers"("id") ON DELETE SET NULL,
  "terms_version" text NOT NULL,
  "terms_accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  CONSTRAINT "classroom_teachers_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_teachers_user_unique" ON "classroom_teachers" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classroom_teachers_school_idx" ON "classroom_teachers" ("school_id");
--> statement-breakpoint
-- An approved teacher vouches for a colleague: whoever signs up with this
-- e-mail for the same school is approved straight away.
CREATE TABLE IF NOT EXISTS "classroom_teacher_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL REFERENCES "classroom_schools"("id") ON DELETE CASCADE,
  "email" varchar(320) NOT NULL,
  "invited_by" uuid NOT NULL REFERENCES "classroom_teachers"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_teacher_invites_unique" ON "classroom_teacher_invites" ("school_id", lower("email"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classroom_classes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL REFERENCES "classroom_schools"("id") ON DELETE CASCADE,
  "owner_teacher_id" uuid NOT NULL REFERENCES "classroom_teachers"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "track" text NOT NULL,
  "language" text NOT NULL,
  "kinds" text[] NOT NULL,
  -- Companies start with the demo dataset, or empty for lessons from zero.
  "seeded" boolean DEFAULT true NOT NULL,
  "modules" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "join_code" varchar(16) NOT NULL,
  "enrolment_open" boolean DEFAULT true NOT NULL,
  "max_students" integer DEFAULT 60 NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "reminded_days" integer,
  "failed_reentries" integer DEFAULT 0 NOT NULL,
  "reentry_locked_until" timestamp with time zone,
  "cleanup_started_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "classroom_classes_track_check" CHECK ("track" IN ('basic', 'standard', 'advanced')),
  CONSTRAINT "classroom_classes_language_check" CHECK ("language" IN ('cs', 'sk', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_classes_join_code_unique" ON "classroom_classes" ("join_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classroom_classes_owner_idx" ON "classroom_classes" ("owner_teacher_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classroom_classes_ends_idx" ON "classroom_classes" ("ends_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classroom_class_teachers" (
  "class_id" uuid NOT NULL REFERENCES "classroom_classes"("id") ON DELETE CASCADE,
  "teacher_id" uuid NOT NULL REFERENCES "classroom_teachers"("id") ON DELETE CASCADE,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("class_id", "teacher_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "classroom_class_id" uuid REFERENCES "classroom_classes"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_classroom_class_idx" ON "tenants" ("classroom_class_id") WHERE "classroom_class_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classroom_students" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "class_id" uuid NOT NULL REFERENCES "classroom_classes"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "nickname" text NOT NULL,
  "kind" text NOT NULL,
  "reentry_code_hash" char(64) NOT NULL,
  "reentry_code_encrypted" text NOT NULL,
  -- When the dataset was in: what is newer is the student's own work.
  "seeded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_students_user_unique" ON "classroom_students" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_students_tenant_unique" ON "classroom_students" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_students_nickname_unique" ON "classroom_students" ("class_id", lower("nickname"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "classroom_students_code_unique" ON "classroom_students" ("class_id", "reentry_code_hash");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tenant_is_classroom(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT classroom_class_id IS NOT NULL FROM tenants WHERE id = p_tenant_id), false);
$$;
--> statement-breakpoint
-- One student joins: their user, practice company, the owner membership,
-- a viewer membership for every teacher of the class, and the student row.
-- p_tenant, p_bank and p_modules come from the backend (the demo dataset
-- and the class settings), never from the student. The advisory lock
-- serialises joins per class so the size limits hold.
CREATE OR REPLACE FUNCTION classroom_join(
  p_class_id uuid,
  p_nickname text,
  p_kind text,
  p_code_hash text,
  p_code_encrypted text,
  p_tenant jsonb,
  p_bank jsonb,
  p_modules jsonb
)
RETURNS TABLE (student_id uuid, tenant_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_class classroom_classes%ROWTYPE;
  v_school classroom_schools%ROWTYPE;
  v_tenant uuid;
  v_user uuid := gen_random_uuid();
  v_student uuid;
  v_expires timestamptz;
  v_bank jsonb;
  v_sort integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('classroom_join:' || p_class_id));
  SELECT * INTO v_class FROM classroom_classes c WHERE c.id = p_class_id;
  IF NOT FOUND OR NOT v_class.enrolment_open OR v_class.ends_at <= now() THEN
    RAISE EXCEPTION 'classroom_closed';
  END IF;
  SELECT * INTO v_school FROM classroom_schools s WHERE s.id = v_class.school_id;
  IF v_school.suspended_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM classroom_teachers t WHERE t.id = v_class.owner_teacher_id AND t.status = 'approved') THEN
    RAISE EXCEPTION 'classroom_closed';
  END IF;
  IF NOT (p_kind = ANY (v_class.kinds)) THEN
    RAISE EXCEPTION 'classroom_invalid_kind';
  END IF;
  IF (SELECT count(*) FROM classroom_students s WHERE s.class_id = p_class_id) >= v_class.max_students THEN
    RAISE EXCEPTION 'classroom_class_full';
  END IF;
  IF (SELECT count(*) FROM classroom_students s JOIN classroom_classes c ON c.id = s.class_id
      WHERE c.school_id = v_class.school_id) >= v_school.max_active_students THEN
    RAISE EXCEPTION 'classroom_school_full';
  END IF;
  IF EXISTS (SELECT 1 FROM classroom_students s WHERE s.class_id = p_class_id AND lower(s.nickname) = lower(p_nickname)) THEN
    RAISE EXCEPTION 'classroom_nickname_taken';
  END IF;

  v_expires := v_class.ends_at + interval '30 days';

  INSERT INTO users (id, email, name, email_verified, is_demo)
  VALUES (v_user, 'student-' || v_user || '@class.billanta.invalid', p_nickname, now(), true);

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
    'off', false, true, p_kind, v_expires, coalesce(p_modules, '{}'::jsonb), p_class_id
  )
  RETURNING id INTO v_tenant;

  INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (v_tenant, v_user, 'owner');
  INSERT INTO tenant_memberships (tenant_id, user_id, role)
  SELECT v_tenant, t.user_id, 'viewer'
  FROM classroom_teachers t
  WHERE t.id = v_class.owner_teacher_id
     OR t.id IN (SELECT ct.teacher_id FROM classroom_class_teachers ct WHERE ct.class_id = p_class_id)
  ON CONFLICT DO NOTHING;

  FOR v_bank IN SELECT * FROM jsonb_array_elements(coalesce(p_bank, '[]'::jsonb)) LOOP
    INSERT INTO tenant_bank_accounts (tenant_id, label, account_number, bank_code, iban, swift, currency, sort_order)
    VALUES (v_tenant, v_bank->>'label', v_bank->>'account_number', v_bank->>'bank_code',
            v_bank->>'iban', v_bank->>'swift', v_bank->>'currency', v_sort);
    v_sort := v_sort + 1;
  END LOOP;

  INSERT INTO classroom_students (class_id, user_id, tenant_id, nickname, kind, reentry_code_hash, reentry_code_encrypted)
  VALUES (p_class_id, v_user, v_tenant, p_nickname, p_kind, p_code_hash, p_code_encrypted)
  RETURNING id INTO v_student;

  RETURN QUERY SELECT v_student, v_tenant, v_user, v_expires;
END;
$$;
--> statement-breakpoint
-- Back in from another device with the personal code. Ten wrong codes in a
-- class lock re-entry for that class for 15 minutes (the codes are short).
-- A wrong code returns no row; a locked class raises.
CREATE OR REPLACE FUNCTION classroom_reenter(p_class_id uuid, p_code_hash text)
RETURNS TABLE (tenant_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_class classroom_classes%ROWTYPE;
  v_student classroom_students%ROWTYPE;
BEGIN
  SELECT * INTO v_class FROM classroom_classes c WHERE c.id = p_class_id FOR UPDATE;
  IF NOT FOUND OR v_class.ends_at + interval '30 days' <= now() THEN
    RETURN;
  END IF;
  IF v_class.reentry_locked_until IS NOT NULL AND v_class.reentry_locked_until > now() THEN
    RAISE EXCEPTION 'classroom_locked_out';
  END IF;
  SELECT * INTO v_student FROM classroom_students s WHERE s.class_id = p_class_id AND s.reentry_code_hash = p_code_hash;
  IF NOT FOUND THEN
    UPDATE classroom_classes SET
      failed_reentries = CASE WHEN failed_reentries + 1 >= 10 THEN 0 ELSE failed_reentries + 1 END,
      reentry_locked_until = CASE WHEN failed_reentries + 1 >= 10 THEN now() + interval '15 minutes' ELSE reentry_locked_until END
    WHERE id = p_class_id;
    RETURN;
  END IF;
  UPDATE classroom_classes SET failed_reentries = 0 WHERE id = p_class_id AND failed_reentries > 0;
  RETURN QUERY SELECT v_student.tenant_id, v_student.user_id, v_class.ends_at + interval '30 days';
END;
$$;
--> statement-breakpoint
-- A teacher gets (or loses) a look into every company of the class.
CREATE OR REPLACE FUNCTION classroom_add_teacher(p_class_id uuid, p_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO classroom_class_teachers (class_id, teacher_id) VALUES (p_class_id, p_teacher_id) ON CONFLICT DO NOTHING;
  INSERT INTO tenant_memberships (tenant_id, user_id, role)
  SELECT s.tenant_id, t.user_id, 'viewer'
  FROM classroom_students s, classroom_teachers t
  WHERE s.class_id = p_class_id AND t.id = p_teacher_id
  ON CONFLICT DO NOTHING;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION classroom_remove_teacher(p_class_id uuid, p_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM classroom_class_teachers WHERE class_id = p_class_id AND teacher_id = p_teacher_id;
  DELETE FROM tenant_memberships m
  USING classroom_students s, classroom_teachers t
  WHERE s.class_id = p_class_id AND t.id = p_teacher_id
    AND m.tenant_id = s.tenant_id AND m.user_id = t.user_id AND m.role = 'viewer';
END;
$$;
--> statement-breakpoint
-- A new end date moves the companies' deletion date with it.
CREATE OR REPLACE FUNCTION classroom_extend(p_class_id uuid, p_ends_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE classroom_classes SET ends_at = p_ends_at, reminded_days = NULL, cleanup_started_at = NULL WHERE id = p_class_id;
  UPDATE tenants SET demo_expires_at = p_ends_at + interval '30 days' WHERE classroom_class_id = p_class_id;
END;
$$;
--> statement-breakpoint
-- One student's company with its user (delete_demo_tenant drops the demo
-- users that were members; the teachers are not demo users and stay).
CREATE OR REPLACE FUNCTION classroom_remove_student(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant FROM classroom_students s WHERE s.id = p_student_id;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;
  PERFORM delete_demo_tenant(v_tenant);
  DELETE FROM classroom_students WHERE id = p_student_id;
END;
$$;
--> statement-breakpoint
-- The whole class: every company, then the class itself.
CREATE OR REPLACE FUNCTION classroom_delete_class(p_class_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student uuid;
BEGIN
  FOR v_student IN SELECT s.id FROM classroom_students s WHERE s.class_id = p_class_id LOOP
    PERFORM classroom_remove_student(v_student);
  END LOOP;
  -- A company whose student row is somehow gone still belongs to the class.
  PERFORM delete_demo_tenant(t.id) FROM tenants t WHERE t.classroom_class_id = p_class_id;
  DELETE FROM classroom_classes WHERE id = p_class_id;
END;
$$;
--> statement-breakpoint
-- The cleanup cron's work list: classes 30 days past their end; a claim
-- that died is retried after p_grace.
CREATE OR REPLACE FUNCTION classroom_claim_expired(p_limit integer, p_grace interval)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE classroom_classes SET cleanup_started_at = now()
  WHERE id IN (
    SELECT id FROM classroom_classes
    WHERE ends_at + interval '30 days' < now()
      AND (cleanup_started_at IS NULL OR cleanup_started_at < now() - p_grace)
    ORDER BY ends_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id;
$$;
--> statement-breakpoint
-- Which class a company belongs to stays as created, and so do its
-- modules: the teacher picks them for the whole class.
CREATE OR REPLACE FUNCTION classroom_tenants_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user <> 'faktur_app' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.classroom_class_id IS NOT NULL THEN
      RAISE EXCEPTION 'demo_locked';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.classroom_class_id IS DISTINCT FROM OLD.classroom_class_id
     OR (OLD.classroom_class_id IS NOT NULL AND NEW.enabled_modules IS DISTINCT FROM OLD.enabled_modules) THEN
    RAISE EXCEPTION 'demo_locked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS classroom_tenants_lock ON tenants;
--> statement-breakpoint
CREATE TRIGGER classroom_tenants_lock BEFORE INSERT OR UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION classroom_tenants_lock();
--> statement-breakpoint
-- Nobody joins or changes roles in a practice company through the app. A
-- teacher's own viewer membership may go (deleting their account), the
-- student's owner membership may not.
CREATE OR REPLACE FUNCTION classroom_memberships_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'faktur_app' AND tenant_is_classroom(coalesce(NEW.tenant_id, OLD.tenant_id))
     AND (TG_OP <> 'DELETE' OR OLD.role = 'owner') THEN
    RAISE EXCEPTION 'demo_locked';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS classroom_memberships_lock ON tenant_memberships;
--> statement-breakpoint
CREATE TRIGGER classroom_memberships_lock BEFORE INSERT OR UPDATE OR DELETE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION classroom_memberships_lock();
--> statement-breakpoint
-- Row caps: TG_ARGV[0] for a demo, TG_ARGV[1] for a practice company,
-- which has a school year to fill instead of a day.
CREATE OR REPLACE FUNCTION demo_row_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_cap integer;
BEGIN
  IF current_user = 'faktur_app' AND tenant_is_demo(NEW.tenant_id) THEN
    v_cap := CASE WHEN TG_NARGS > 1 AND tenant_is_classroom(NEW.tenant_id) THEN TG_ARGV[1] ELSE TG_ARGV[0] END::integer;
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = $1', TG_TABLE_NAME) INTO v_count USING NEW.tenant_id;
    IF v_count >= v_cap THEN
      RAISE EXCEPTION 'demo_limit';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('invoices', 100, 1000), ('contacts', 200, 500), ('expenses', 200, 1000),
                                 ('time_entries', 500, 2000), ('bank_transactions', 300, 2000)) AS v(tbl, cap, class_cap) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS demo_row_cap ON %I', c.tbl);
    EXECUTE format('CREATE TRIGGER demo_row_cap BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION demo_row_cap(%L, %L)',
                   c.tbl, c.cap, c.class_cap);
  END LOOP;
END $$;
--> statement-breakpoint
-- As in 0068, plus the students' reserved domain.
CREATE OR REPLACE FUNCTION demo_email_outbox_drop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.recipient) LIKE '%@demo.billanta.invalid'
     OR lower(NEW.recipient) LIKE '%@class.billanta.invalid'
     OR (NEW.tenant_id IS NOT NULL AND tenant_is_demo(NEW.tenant_id)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- The company switcher leaves out the practice companies a teacher looks
-- into; the class page opens them. Same function as in rls-policies.sql.
DROP FUNCTION IF EXISTS list_tenant_memberships_for_user(uuid);
--> statement-breakpoint
CREATE FUNCTION list_tenant_memberships_for_user(p_user_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  company_name text,
  role text,
  classroom boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tm.tenant_id,
    t.company_name,
    tm.role::text,
    t.classroom_class_id IS NOT NULL
  FROM tenant_memberships tm
  JOIN tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = p_user_id
  ORDER BY tm.created_at, t.company_name;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_tenant_memberships_for_user(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_is_classroom(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_join(uuid, text, text, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_reenter(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_add_teacher(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_remove_teacher(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_extend(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_remove_student(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_delete_class(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_claim_expired(integer, interval) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION list_tenant_memberships_for_user(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION tenant_is_classroom(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_join(uuid, text, text, text, text, jsonb, jsonb, jsonb) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_reenter(uuid, text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_add_teacher(uuid, uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_remove_teacher(uuid, uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_extend(uuid, timestamptz) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_remove_student(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_delete_class(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_claim_expired(integer, interval) TO faktur_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON classroom_schools, classroom_teachers, classroom_teacher_invites, classroom_classes TO faktur_app;
    -- Class teachers and students only change through the functions above.
    GRANT SELECT ON classroom_class_teachers TO faktur_app;
    REVOKE INSERT, UPDATE, DELETE ON classroom_class_teachers FROM faktur_app;
    GRANT SELECT, UPDATE ON classroom_students TO faktur_app;
    REVOKE INSERT, DELETE ON classroom_students FROM faktur_app;
  END IF;
END $$;
