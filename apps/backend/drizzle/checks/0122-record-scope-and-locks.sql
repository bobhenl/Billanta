-- Rolled-back check of the record scopes and access locks (migration 0122
-- and the member_visibility / member_edit_scope policies in
-- rls-policies.sql). Builds a small team in the demo company, then asks the
-- database as each member what they see and what they may change. Any
-- failed ASSERT aborts with its message; nothing is kept either way.
--
--   docker exec -i faktur-postgres-dev sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < apps/backend/drizzle/checks/0122-record-scope-and-locks.sql

BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_owner uuid;
  v_admin uuid;
  v_seller uuid;
  v_other uuid;
  v_viewer uuid;
  v_c_seller uuid;
  v_c_other uuid;
  v_id uuid;
BEGIN
  SELECT u.id, m.tenant_id INTO v_owner, v_tenant
  FROM users u JOIN tenant_memberships m ON m.user_id = u.id AND m.role = 'owner'
  WHERE u.email = 'demo@faktur.local'
  ORDER BY m.created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'demo@faktur.local owns no company; sign in once first';
  END IF;
  PERFORM set_config('app.current_tenant_id', v_tenant::text, true);
  PERFORM set_config('chk.tenant', v_tenant::text, true);
  PERFORM set_config('chk.owner', v_owner::text, true);

  INSERT INTO users (email) VALUES ('check-admin@0122.example') RETURNING id INTO v_admin;
  INSERT INTO users (email) VALUES ('check-seller@0122.example') RETURNING id INTO v_seller;
  INSERT INTO users (email) VALUES ('check-other@0122.example') RETURNING id INTO v_other;
  INSERT INTO users (email) VALUES ('check-viewer@0122.example') RETURNING id INTO v_viewer;
  INSERT INTO tenant_memberships (tenant_id, user_id, role, invoice_scope, expense_scope) VALUES
    (v_tenant, v_admin, 'admin', 'all', 'all'),
    (v_tenant, v_seller, 'accountant', 'own', 'own'),
    (v_tenant, v_other, 'accountant', 'all', 'all'),
    (v_tenant, v_viewer, 'viewer', 'all', 'all');
  PERFORM set_config('chk.admin', v_admin::text, true);
  PERFORM set_config('chk.seller', v_seller::text, true);
  PERFORM set_config('chk.other', v_other::text, true);
  PERFORM set_config('chk.viewer', v_viewer::text, true);

  INSERT INTO contacts (tenant_id, legal_name, owner_user_id) VALUES (v_tenant, 'Check seller client', v_seller) RETURNING id INTO v_c_seller;
  INSERT INTO contacts (tenant_id, legal_name, owner_user_id) VALUES (v_tenant, 'Check other client', v_other) RETURNING id INTO v_c_other;
  PERFORM set_config('chk.c_seller', v_c_seller::text, true);
  PERFORM set_config('chk.c_other', v_c_other::text, true);

  -- The seller's invoice for someone else's client.
  INSERT INTO invoices (tenant_id, contact_id, created_by_user_id) VALUES (v_tenant, v_c_other, v_seller) RETURNING id INTO v_id;
  INSERT INTO invoice_line_items (tenant_id, invoice_id, description, unit_price) VALUES (v_tenant, v_id, 'a', 100);
  PERFORM set_config('chk.i_seller', v_id::text, true);
  -- Another member's invoice for the seller's client: theirs through the client.
  INSERT INTO invoices (tenant_id, contact_id, created_by_user_id) VALUES (v_tenant, v_c_seller, v_other) RETURNING id INTO v_id;
  INSERT INTO invoice_line_items (tenant_id, invoice_id, description, unit_price) VALUES (v_tenant, v_id, 'b', 1000);
  PERFORM set_config('chk.i_client', v_id::text, true);
  -- Another member's invoices: for their own client and without a client.
  INSERT INTO invoices (tenant_id, contact_id, created_by_user_id) VALUES (v_tenant, v_c_other, v_other) RETURNING id INTO v_id;
  INSERT INTO invoice_line_items (tenant_id, invoice_id, description, unit_price) VALUES (v_tenant, v_id, 'c', 10000);
  PERFORM set_config('chk.i_other', v_id::text, true);
  INSERT INTO invoices (tenant_id, created_by_user_id) VALUES (v_tenant, v_other) RETURNING id INTO v_id;
  INSERT INTO invoice_line_items (tenant_id, invoice_id, description, unit_price) VALUES (v_tenant, v_id, 'd', 100000);
  PERFORM set_config('chk.i_loose', v_id::text, true);

  INSERT INTO expenses (tenant_id, description, amount, vat_rate, expense_date, created_by_user_id)
  VALUES (v_tenant, 'Check seller expense', 10, 21, now(), v_seller) RETURNING id INTO v_id;
  PERFORM set_config('chk.e_seller', v_id::text, true);
  INSERT INTO expenses (tenant_id, description, amount, vat_rate, expense_date, created_by_user_id)
  VALUES (v_tenant, 'Check other expense', 20, 21, now(), v_other) RETURNING id INTO v_id;
  PERFORM set_config('chk.e_other', v_id::text, true);

  INSERT INTO audit_log (tenant_id, entity_type, entity_id, entity_label, action)
  VALUES (v_tenant, 'expense', v_id, 'Check other expense', 'created');
END $$;

SET LOCAL ROLE faktur_app;

-- ---- own scope: only what the seller made or what is of their clients ------
SELECT set_config('app.current_user_id', current_setting('chk.seller'), true);
DO $$
DECLARE n numeric;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_seller')::uuid), 'own: seller lost the invoice they made';
  ASSERT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_client')::uuid), 'own: seller lost the invoice of their client';
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_other')::uuid), 'own: seller reads another member''s invoice';
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_loose')::uuid), 'own: seller reads another member''s invoice without a client';
  ASSERT EXISTS (SELECT 1 FROM expenses WHERE id = current_setting('chk.e_seller')::uuid), 'own: seller lost their expense';
  ASSERT NOT EXISTS (SELECT 1 FROM expenses WHERE id = current_setting('chk.e_other')::uuid), 'own: seller reads another member''s expense';
  -- A report adds up what the member sees, so nothing of the others leaks into it.
  SELECT sum(unit_price) INTO n FROM invoice_line_items WHERE invoice_id IN (
    current_setting('chk.i_seller')::uuid, current_setting('chk.i_client')::uuid, current_setting('chk.i_other')::uuid, current_setting('chk.i_loose')::uuid);
  ASSERT n = 1100, format('own: seller''s total counts other invoices (%s)', n);
  ASSERT NOT app_view_complete(), 'own: a limited member is told their view is complete';
  -- Writing another member's invoice touches nothing: it is not there for them.
  UPDATE invoices SET internal_note = 'x' WHERE id = current_setting('chk.i_other')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'own: seller changed another member''s invoice';
END $$;

-- ---- the owner sees everything, whatever the scopes and locks -------------
SELECT set_config('app.current_user_id', current_setting('chk.owner'), true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM invoices WHERE created_by_user_id IN (current_setting('chk.seller')::uuid, current_setting('chk.other')::uuid);
  ASSERT n = 4, 'owner should see all four invoices';
  SELECT count(*) INTO n FROM expenses WHERE created_by_user_id IN (current_setting('chk.seller')::uuid, current_setting('chk.other')::uuid);
  ASSERT n = 2, 'owner should see both expenses';
  -- edit_own for the seller from here on.
  UPDATE tenant_memberships SET invoice_scope = 'edit_own', expense_scope = 'edit_own' WHERE user_id = current_setting('chk.seller')::uuid;
END $$;

-- ---- edit_own: reads everything, writes only own ---------------------------
SELECT set_config('app.current_user_id', current_setting('chk.seller'), true);
DO $$
DECLARE n int;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_other')::uuid), 'edit_own: seller should read another member''s invoice';
  ASSERT EXISTS (SELECT 1 FROM expenses WHERE id = current_setting('chk.e_other')::uuid), 'edit_own: seller should read another member''s expense';
  UPDATE invoices SET internal_note = 'mine' WHERE id = current_setting('chk.i_seller')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'edit_own: seller could not change their own invoice';
  UPDATE invoices SET internal_note = 'client' WHERE id = current_setting('chk.i_client')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'edit_own: seller could not change the invoice of their client';
  BEGIN
    UPDATE invoices SET internal_note = 'x' WHERE id = current_setting('chk.i_other')::uuid;
    RAISE EXCEPTION 'edit_own: seller changed another member''s invoice';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    UPDATE expenses SET description = 'x' WHERE id = current_setting('chk.e_other')::uuid;
    RAISE EXCEPTION 'edit_own: seller changed another member''s expense';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO invoice_line_items (tenant_id, invoice_id, description, unit_price)
    VALUES (current_setting('chk.tenant')::uuid, current_setting('chk.i_other')::uuid, 'x', 1);
    RAISE EXCEPTION 'edit_own: seller added an item to another member''s invoice';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  DELETE FROM expenses WHERE id = current_setting('chk.e_other')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'edit_own: seller deleted another member''s expense';
END $$;

-- ---- locks: set by the record's person, held by whoever set them -----------
SELECT set_config('app.current_user_id', current_setting('chk.seller'), true);
DO $$
BEGIN
  -- Not theirs and not an admin: no lock.
  BEGIN
    UPDATE invoices SET access_lock = 'private', access_lock_user_id = current_setting('chk.seller')::uuid WHERE id = current_setting('chk.i_other')::uuid;
    RAISE EXCEPTION 'seller locked another member''s invoice';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('app.current_user_id', current_setting('chk.other'), true);
DO $$
DECLARE n int;
BEGIN
  UPDATE invoices SET access_lock = 'private', access_lock_user_id = current_setting('chk.other')::uuid WHERE id = current_setting('chk.i_loose')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'the creator could not lock their invoice';
  ASSERT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_loose')::uuid), 'the holder lost their locked invoice';
  UPDATE expenses SET access_lock = 'admin', access_lock_user_id = current_setting('chk.other')::uuid WHERE id = current_setting('chk.e_other')::uuid;
  UPDATE contacts SET access_lock = 'accountant', access_lock_user_id = current_setting('chk.other')::uuid WHERE id = current_setting('chk.c_other')::uuid;
  -- A lock in someone else's name is refused, even one the setter still sees through.
  BEGIN
    UPDATE invoices SET access_lock = 'accountant', access_lock_user_id = current_setting('chk.owner')::uuid WHERE id = current_setting('chk.i_other')::uuid;
    RAISE EXCEPTION 'a lock was set in someone else''s name';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- A record they see but isn't theirs is not theirs to lock.
  BEGIN
    UPDATE expenses SET access_lock = 'private', access_lock_user_id = current_setting('chk.other')::uuid WHERE id = current_setting('chk.e_seller')::uuid;
    RAISE EXCEPTION 'a member locked another member''s expense';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('app.current_user_id', current_setting('chk.seller'), true);
DO $$
DECLARE n numeric;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_loose')::uuid), 'a member sees a private invoice';
  ASSERT NOT EXISTS (SELECT 1 FROM invoice_line_items WHERE invoice_id = current_setting('chk.i_loose')::uuid), 'a member sees the items of a private invoice';
  ASSERT NOT EXISTS (SELECT 1 FROM expenses WHERE id = current_setting('chk.e_other')::uuid), 'a member sees an expense locked to admins';
  ASSERT NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_id = current_setting('chk.e_other')::uuid), 'a member sees the history of a locked expense';
  ASSERT EXISTS (SELECT 1 FROM contacts WHERE id = current_setting('chk.c_other')::uuid), 'an accountant should see a client locked to accountants';
  SELECT coalesce(sum(unit_price), 0) INTO n FROM invoice_line_items WHERE invoice_id = current_setting('chk.i_loose')::uuid;
  ASSERT n = 0, 'a locked invoice counts in a member''s totals';
  ASSERT NOT app_view_complete(), 'a member is told their view is complete while a lock hides something';
  -- They see the client lock but it is not theirs to lift.
  BEGIN
    UPDATE contacts SET access_lock = NULL, access_lock_user_id = NULL WHERE id = current_setting('chk.c_other')::uuid;
    RAISE EXCEPTION 'a member lifted someone else''s lock';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('app.current_user_id', current_setting('chk.viewer'), true);
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM contacts WHERE id = current_setting('chk.c_other')::uuid), 'a viewer sees a client locked to accountants';
  -- Its documents go with it, unless the viewer made them.
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_other')::uuid), 'a viewer sees an invoice of a locked client';
END $$;

SELECT set_config('app.current_user_id', current_setting('chk.admin'), true);
DO $$
DECLARE n int;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_loose')::uuid), 'an admin sees a private invoice';
  ASSERT EXISTS (SELECT 1 FROM expenses WHERE id = current_setting('chk.e_other')::uuid), 'an admin should see an expense locked to admins';
  -- A manager may lock what isn't locked yet, in their own name.
  UPDATE invoices SET access_lock = 'admin', access_lock_user_id = current_setting('chk.admin')::uuid WHERE id = current_setting('chk.i_seller')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'an admin could not lock an invoice';
  -- But not lift a lock someone else holds, even one they can see.
  BEGIN
    UPDATE expenses SET access_lock = NULL, access_lock_user_id = NULL WHERE id = current_setting('chk.e_other')::uuid;
    RAISE EXCEPTION 'an admin lifted someone else''s lock';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Nor change what a member sees, or lift it by promotion.
  BEGIN
    UPDATE tenant_memberships SET invoice_scope = 'all' WHERE user_id = current_setting('chk.seller')::uuid;
    RAISE EXCEPTION 'an admin widened a member''s invoice scope';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE tenant_memberships SET role = 'admin' WHERE user_id = current_setting('chk.seller')::uuid;
    RAISE EXCEPTION 'an admin promoted an edit_own member';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- The seller made it, but the admin's lock keeps them out.
SELECT set_config('app.current_user_id', current_setting('chk.seller'), true);
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.i_seller')::uuid), 'a creator still sees an invoice an admin locked away';
END $$;

-- ---- the owner: everything, locked or not, and every lock is theirs to lift
SELECT set_config('app.current_user_id', current_setting('chk.owner'), true);
DO $$
DECLARE n numeric;
BEGIN
  SELECT sum(unit_price) INTO n FROM invoice_line_items WHERE invoice_id IN (
    current_setting('chk.i_seller')::uuid, current_setting('chk.i_client')::uuid, current_setting('chk.i_other')::uuid, current_setting('chk.i_loose')::uuid);
  ASSERT n = 111100, format('owner''s total misses locked invoices (%s)', n);
  ASSERT EXISTS (SELECT 1 FROM expenses WHERE id = current_setting('chk.e_other')::uuid), 'owner should see a locked expense';
  ASSERT EXISTS (SELECT 1 FROM audit_log WHERE entity_id = current_setting('chk.e_other')::uuid), 'owner should see the history of a locked expense';
  ASSERT app_view_complete(), 'the owner''s view is always complete';
  UPDATE invoices SET access_lock = NULL, access_lock_user_id = NULL WHERE id = current_setting('chk.i_loose')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'owner could not lift a member''s lock';
END $$;

\echo '0122 record scope and locks: all checks passed (rolled back)'
ROLLBACK;
