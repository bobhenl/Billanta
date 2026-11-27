-- Rolled-back check of the member visibility rules (migration 0111 and the
-- member_visibility policies in rls-policies.sql). Builds a small team in the
-- demo company, then asks the database as each member what they see and
-- what they may change. Any failed ASSERT aborts with its message; nothing
-- is kept either way.
--
--   docker exec -i faktur-postgres-dev sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < apps/backend/drizzle/checks/0111-member-privacy.sql

BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_owner uuid;
  v_admin uuid;
  v_seller uuid;
  v_shared uuid;
  v_private uuid;
  v_inv_shared uuid;
  v_inv_private uuid;
  v_inv_client uuid;
BEGIN
  SELECT u.id, m.tenant_id INTO v_owner, v_tenant
  FROM users u JOIN tenant_memberships m ON m.user_id = u.id AND m.role = 'owner'
  WHERE u.email = 'demo@faktur.local'
  ORDER BY m.created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'demo@faktur.local owns no company; sign in once first';
  END IF;
  PERFORM set_config('app.current_tenant_id', v_tenant::text, true);

  -- The migration alone hides nothing: no invoice was private before this check.
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE tenant_id = v_tenant AND is_private), 'an invoice is private before anyone marked it';

  INSERT INTO users (email) VALUES ('check-admin@0111.example') RETURNING id INTO v_admin;
  INSERT INTO users (email) VALUES ('check-seller@0111.example') RETURNING id INTO v_seller;
  INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (v_tenant, v_admin, 'admin'), (v_tenant, v_seller, 'accountant');

  INSERT INTO contacts (tenant_id, legal_name) VALUES (v_tenant, 'Check shared client') RETURNING id INTO v_shared;
  INSERT INTO contacts (tenant_id, legal_name, owner_user_id, is_private) VALUES (v_tenant, 'Check private client', v_seller, true) RETURNING id INTO v_private;
  INSERT INTO invoices (tenant_id, contact_id, created_by_user_id) VALUES (v_tenant, v_shared, v_owner) RETURNING id INTO v_inv_shared;
  INSERT INTO invoices (tenant_id, contact_id, created_by_user_id, is_private) VALUES (v_tenant, v_shared, v_seller, true) RETURNING id INTO v_inv_private;
  INSERT INTO invoices (tenant_id, contact_id, created_by_user_id) VALUES (v_tenant, v_private, v_seller) RETURNING id INTO v_inv_client;

  INSERT INTO audit_log (tenant_id, entity_type, entity_id, entity_label, action)
  VALUES (v_tenant, 'contact', v_private, 'Check private client', 'created');
  INSERT INTO notifications (tenant_id, user_id, kind, title, link)
  VALUES (v_tenant, v_admin, 'invoice_paid', 'Check private invoice paid', '/invoices/' || v_inv_private);

  PERFORM set_config('chk.tenant', v_tenant::text, true);
  PERFORM set_config('chk.owner', v_owner::text, true);
  PERFORM set_config('chk.admin', v_admin::text, true);
  PERFORM set_config('chk.seller', v_seller::text, true);
  PERFORM set_config('chk.shared', v_shared::text, true);
  PERFORM set_config('chk.private', v_private::text, true);
  PERFORM set_config('chk.inv_shared', v_inv_shared::text, true);
  PERFORM set_config('chk.inv_private', v_inv_private::text, true);
  PERFORM set_config('chk.inv_client', v_inv_client::text, true);
END $$;

SET LOCAL ROLE faktur_app;

-- ---- the admin: sees the company, not what the owner kept private ----------
SELECT set_config('app.current_user_id', current_setting('chk.admin'), true);
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.inv_shared')::uuid), 'admin should see the shared invoice';
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.inv_private')::uuid), 'admin sees a private invoice';
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.inv_client')::uuid), 'admin sees an invoice of a private client';
  ASSERT NOT EXISTS (SELECT 1 FROM contacts WHERE id = current_setting('chk.private')::uuid), 'admin sees a private client';
  ASSERT NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_id = current_setting('chk.private')::uuid), 'admin sees the history of a private client';
  ASSERT NOT EXISTS (SELECT 1 FROM notifications WHERE link = '/invoices/' || current_setting('chk.inv_private')), 'admin sees a notification about a private invoice';
END $$;

-- Every change below must be refused by the 0111 trigger, whatever the API does.
DO $$
BEGIN
  BEGIN
    UPDATE contacts SET is_private = true WHERE id = current_setting('chk.shared')::uuid;
    RAISE EXCEPTION 'admin marked a client private';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE contacts SET owner_user_id = current_setting('chk.admin')::uuid WHERE id = current_setting('chk.shared')::uuid;
    RAISE EXCEPTION 'admin took a client over';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE invoices SET is_private = true WHERE id = current_setting('chk.inv_shared')::uuid;
    RAISE EXCEPTION 'admin marked an invoice private';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE invoices SET created_by_user_id = current_setting('chk.admin')::uuid WHERE id = current_setting('chk.inv_shared')::uuid;
    RAISE EXCEPTION 'admin rewrote who created an invoice';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE tenant_memberships SET contact_scope = 'own' WHERE user_id = current_setting('chk.seller')::uuid;
    RAISE EXCEPTION 'admin changed which clients a member sees';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ---- the seller: their private client and their private invoice ----------
SELECT set_config('app.current_user_id', current_setting('chk.seller'), true);
DO $$
DECLARE n int;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM contacts WHERE id = current_setting('chk.private')::uuid), 'seller should see their private client';
  ASSERT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.inv_private')::uuid), 'seller should see the invoice they made private';
  ASSERT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.inv_client')::uuid), 'seller should see the invoice of their client';
  -- Unmarking is theirs to do.
  UPDATE invoices SET is_private = false WHERE id = current_setting('chk.inv_private')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'seller could not unmark their own invoice';
  UPDATE invoices SET is_private = true WHERE id = current_setting('chk.inv_private')::uuid;
  -- Giving a private client away would hide it from them: the policy refuses the new row.
  BEGIN
    UPDATE contacts SET owner_user_id = current_setting('chk.admin')::uuid WHERE id = current_setting('chk.private')::uuid;
    RAISE EXCEPTION 'seller handed a private client to someone else';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ---- the owner: sees and decides everything -------------------------------
SELECT set_config('app.current_user_id', current_setting('chk.owner'), true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM invoices WHERE id IN (current_setting('chk.inv_shared')::uuid, current_setting('chk.inv_private')::uuid, current_setting('chk.inv_client')::uuid);
  ASSERT n = 3, 'owner should see all three invoices';
  ASSERT EXISTS (SELECT 1 FROM audit_log WHERE entity_id = current_setting('chk.private')::uuid), 'owner should see the private client history';
  UPDATE tenant_memberships SET contact_scope = 'own' WHERE user_id = current_setting('chk.seller')::uuid;
  UPDATE contacts SET owner_user_id = current_setting('chk.admin')::uuid WHERE id = current_setting('chk.private')::uuid;
  UPDATE invoices SET is_private = true WHERE id = current_setting('chk.inv_shared')::uuid;
END $$;

-- ---- a limited seller now: only what is theirs ----------------------------
SELECT set_config('app.current_user_id', current_setting('chk.seller'), true);
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM contacts WHERE id = current_setting('chk.private')::uuid), 'seller still sees the client the owner gave away';
  -- Still theirs: they created it.
  ASSERT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.inv_client')::uuid), 'seller lost the invoice they created';
  ASSERT NOT EXISTS (SELECT 1 FROM invoices WHERE id = current_setting('chk.inv_shared')::uuid), 'seller sees an invoice the owner made private';
END $$;

\echo '0111 member privacy: all checks passed (rolled back)'
ROLLBACK;
