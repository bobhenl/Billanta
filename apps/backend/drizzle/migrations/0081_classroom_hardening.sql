-- Classroom mode hardening after the security review of 0080.
--
-- 1. A teacher's look into the students' companies (the viewer memberships)
--    now follows the teacher's standing: only approved teachers of a school
--    that is not suspended keep it. classroom_sync_class derives the
--    memberships from that, so suspending a school and lifting it again is
--    reversible. Rejecting a teacher takes them off every class they
--    co-teach and ends the classes they own: enrolment closes and the
--    companies become read-only for the usual 30 days before deletion, the
--    same as a teacher ending a class early (plan §1, "end the class
--    early"). Nobody approved owns those classes any more, and deleting them
--    on the spot would take the students' work away without warning; staff
--    who approve the teacher again can let them extend the class.
-- 2. Wrong re-entry codes are counted per network (salted IP hash) within a
--    class, not per class: ten misses from one visitor no longer lock out the
--    whole class. The codes are 8 characters of a 31-letter alphabet, so the
--    per-visitor limit is what matters against guessing.
-- 3. classroom_join and classroom_add_teacher give the viewer membership to
--    approved teachers only.
-- 4. classroom_students gets row-level security: a student sees their own
--    row (their company is the current tenant), an approved teacher the rows
--    of the classes they teach (app.current_user_id).
CREATE TABLE IF NOT EXISTS "classroom_reentry_misses" (
  "class_id" uuid NOT NULL REFERENCES "classroom_classes"("id") ON DELETE CASCADE,
  "ip_hash" char(64) NOT NULL,
  "misses" integer DEFAULT 0 NOT NULL,
  "window_started_at" timestamp with time zone,
  "locked_until" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("class_id", "ip_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classroom_reentry_misses_updated_idx" ON "classroom_reentry_misses" ("updated_at");
--> statement-breakpoint
DROP FUNCTION IF EXISTS classroom_reenter(uuid, text);
--> statement-breakpoint
ALTER TABLE "classroom_classes" DROP COLUMN IF EXISTS "failed_reentries";
--> statement-breakpoint
ALTER TABLE "classroom_classes" DROP COLUMN IF EXISTS "reentry_locked_until";
--> statement-breakpoint
-- Back in from another device with the personal code. Twenty wrong codes
-- from one network within 15 minutes lock re-entry into this class for that
-- network for 15 minutes. Twenty, not ten: a whole class sits behind one
-- school address and mistypes. A wrong code returns no row; a lock raises.
CREATE OR REPLACE FUNCTION classroom_reenter(p_class_id uuid, p_code_hash text, p_ip_hash text)
RETURNS TABLE (tenant_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_ends timestamptz;
  v_miss classroom_reentry_misses%ROWTYPE;
  v_student classroom_students%ROWTYPE;
BEGIN
  SELECT c.ends_at INTO v_ends FROM classroom_classes c WHERE c.id = p_class_id;
  IF NOT FOUND OR v_ends + interval '30 days' <= now() THEN
    RETURN;
  END IF;
  INSERT INTO classroom_reentry_misses (class_id, ip_hash) VALUES (p_class_id, p_ip_hash) ON CONFLICT DO NOTHING;
  SELECT * INTO v_miss FROM classroom_reentry_misses m WHERE m.class_id = p_class_id AND m.ip_hash = p_ip_hash FOR UPDATE;
  IF v_miss.locked_until IS NOT NULL AND v_miss.locked_until > now() THEN
    RAISE EXCEPTION 'classroom_locked_out';
  END IF;
  SELECT * INTO v_student FROM classroom_students s WHERE s.class_id = p_class_id AND s.reentry_code_hash = p_code_hash;
  IF NOT FOUND THEN
    IF v_miss.window_started_at IS NULL OR v_miss.window_started_at <= now() - interval '15 minutes' THEN
      v_miss.misses := 0;
      v_miss.window_started_at := now();
    END IF;
    v_miss.misses := v_miss.misses + 1;
    UPDATE classroom_reentry_misses m SET
      misses = CASE WHEN v_miss.misses >= 20 THEN 0 ELSE v_miss.misses END,
      window_started_at = CASE WHEN v_miss.misses >= 20 THEN NULL ELSE v_miss.window_started_at END,
      locked_until = CASE WHEN v_miss.misses >= 20 THEN now() + interval '15 minutes' ELSE m.locked_until END,
      updated_at = now()
    WHERE m.class_id = p_class_id AND m.ip_hash = p_ip_hash;
    -- Counters nobody hit for a day are noise.
    DELETE FROM classroom_reentry_misses m WHERE m.updated_at < now() - interval '1 day';
    RETURN;
  END IF;
  DELETE FROM classroom_reentry_misses m WHERE m.class_id = p_class_id AND m.ip_hash = p_ip_hash;
  RETURN QUERY SELECT v_student.tenant_id, v_student.user_id, v_ends + interval '30 days';
END;
$$;
--> statement-breakpoint
-- As in 0080, except that only approved co-teachers get the look in. The
-- owner is checked above; a suspended school does not get this far.
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
  WHERE t.status = 'approved'
    AND (t.id = v_class.owner_teacher_id
         OR t.id IN (SELECT ct.teacher_id FROM classroom_class_teachers ct WHERE ct.class_id = p_class_id))
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
-- As in 0080; the backend checks the colleague is approved, this holds even
-- if it did not.
CREATE OR REPLACE FUNCTION classroom_add_teacher(p_class_id uuid, p_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO classroom_class_teachers (class_id, teacher_id) VALUES (p_class_id, p_teacher_id) ON CONFLICT DO NOTHING;
  PERFORM classroom_sync_class(p_class_id);
END;
$$;
--> statement-breakpoint
-- The viewer memberships of a class's companies, made to match who may look
-- in now: the owner and the co-teachers, if approved and their school is
-- not suspended. The memberships of a practice company are the student's
-- owner row and these viewers (classroom_memberships_lock), so every other
-- viewer goes.
CREATE OR REPLACE FUNCTION classroom_sync_class(p_class_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entitled uuid[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT t.user_id), '{}') INTO v_entitled
  FROM classroom_classes c
  JOIN classroom_schools s ON s.id = c.school_id
  JOIN classroom_teachers t
    ON t.id = c.owner_teacher_id
    OR t.id IN (SELECT ct.teacher_id FROM classroom_class_teachers ct WHERE ct.class_id = c.id)
  WHERE c.id = p_class_id AND t.status = 'approved' AND s.suspended_at IS NULL;

  DELETE FROM tenant_memberships m
  USING tenants tn
  WHERE tn.classroom_class_id = p_class_id AND m.tenant_id = tn.id AND m.role = 'viewer'
    AND NOT (m.user_id = ANY (v_entitled));

  INSERT INTO tenant_memberships (tenant_id, user_id, role)
  SELECT tn.id, e.user_id, 'viewer'
  FROM tenants tn, unnest(v_entitled) AS e(user_id)
  WHERE tn.classroom_class_id = p_class_id
  ON CONFLICT DO NOTHING;
END;
$$;
--> statement-breakpoint
-- After a teacher is approved (again): their classes let them back in.
CREATE OR REPLACE FUNCTION classroom_sync_teacher(p_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class uuid;
BEGIN
  FOR v_class IN
    SELECT c.id FROM classroom_classes c WHERE c.owner_teacher_id = p_teacher_id
    UNION
    SELECT ct.class_id FROM classroom_class_teachers ct WHERE ct.teacher_id = p_teacher_id
  LOOP
    PERFORM classroom_sync_class(v_class);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- A school suspended or let back in: every class follows.
CREATE OR REPLACE FUNCTION classroom_sync_school(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class uuid;
BEGIN
  FOR v_class IN SELECT c.id FROM classroom_classes c WHERE c.school_id = p_school_id LOOP
    PERFORM classroom_sync_class(v_class);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Staff reject a teacher (also one approved before): off every class they
-- co-teach, and their own classes end now (see the header).
CREATE OR REPLACE FUNCTION classroom_reject_teacher(p_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class uuid;
BEGIN
  UPDATE classroom_teachers SET status = 'rejected', decided_at = now() WHERE id = p_teacher_id;
  FOR v_class IN SELECT ct.class_id FROM classroom_class_teachers ct WHERE ct.teacher_id = p_teacher_id LOOP
    DELETE FROM classroom_class_teachers WHERE class_id = v_class AND teacher_id = p_teacher_id;
    PERFORM classroom_sync_class(v_class);
  END LOOP;
  UPDATE classroom_classes SET enrolment_open = false, ends_at = least(ends_at, now())
  WHERE owner_teacher_id = p_teacher_id;
  UPDATE tenants tn SET demo_expires_at = c.ends_at + interval '30 days'
  FROM classroom_classes c
  WHERE c.owner_teacher_id = p_teacher_id AND tn.classroom_class_id = c.id;
  FOR v_class IN SELECT c.id FROM classroom_classes c WHERE c.owner_teacher_id = p_teacher_id LOOP
    PERFORM classroom_sync_class(v_class);
  END LOOP;
END;
$$;
--> statement-breakpoint
ALTER TABLE "classroom_students" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "classroom_students" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS classroom_students_access ON "classroom_students";
--> statement-breakpoint
-- nullif: a pooled connection whose last transaction set these locally has
-- them as '' afterwards, and ''::uuid would fail the query instead of
-- matching nothing.
CREATE POLICY classroom_students_access ON "classroom_students"
  USING (
    tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
    OR class_id IN (
      SELECT c.id
      FROM classroom_classes c
      JOIN classroom_teachers t ON t.status = 'approved'
        AND t.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
      WHERE c.owner_teacher_id = t.id
         OR c.id IN (SELECT ct.class_id FROM classroom_class_teachers ct WHERE ct.teacher_id = t.id)
    )
  );
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_reenter(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_join(uuid, text, text, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_add_teacher(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_sync_class(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_sync_teacher(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_sync_school(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION classroom_reject_teacher(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION classroom_reenter(uuid, text, text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_join(uuid, text, text, text, text, jsonb, jsonb, jsonb) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_add_teacher(uuid, uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_sync_class(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_sync_teacher(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_sync_school(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION classroom_reject_teacher(uuid) TO faktur_app;
    -- The counters are the definer function's own business.
    REVOKE ALL ON classroom_reentry_misses FROM faktur_app;
  END IF;
END $$;
