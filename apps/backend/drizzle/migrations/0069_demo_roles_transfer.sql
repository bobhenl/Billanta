-- Demo playground, part two:
--   - team views: a demo can be looked at as its accountant or a read-only
--     colleague. Those are more password-less demo users with a membership in
--     the same demo company, made on first use by demo_member();
--   - taking your work along: a visitor who signs up can move what they made
--     in the demo (contacts, documents as drafts, expenses) into their own
--     company. The demo side hands out a one-time token (only its hash is
--     kept); the new account redeems it with claim_demo_transfer(), which
--     returns the rows as JSON. The backend writes them into the real company
--     through RLS like any other input, so nothing here writes across tenants.
-- "What the visitor made" = rows created after seeding finished (seeded_at).
ALTER TABLE "demo_sessions" ADD COLUMN IF NOT EXISTS "seeded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "demo_sessions" ADD COLUMN IF NOT EXISTS "transfer_token_hash" char(64);
--> statement-breakpoint
ALTER TABLE "demo_sessions" ADD COLUMN IF NOT EXISTS "transferred_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "demo_sessions_transfer_token_unique" ON "demo_sessions" ("transfer_token_hash")
  WHERE "transfer_token_hash" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mark_demo_seeded(p_tenant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE demo_sessions SET seeded_at = now() WHERE tenant_id = p_tenant_id AND seeded_at IS NULL;
$$;
--> statement-breakpoint
-- The demo user acting in p_role in this demo company, made on first call.
-- Callable only from inside that same demo (the API's tenant context), so a
-- visitor can only ever reach the users of their own demo. 'owner' is the
-- user the demo was started with.
CREATE OR REPLACE FUNCTION demo_member(p_tenant_id uuid, p_role text, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF p_tenant_id::text IS DISTINCT FROM current_setting('app.current_tenant_id', true) THEN
    RAISE EXCEPTION 'demo_forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id AND is_demo AND demo_expires_at > now()) THEN
    RAISE EXCEPTION 'demo_forbidden';
  END IF;
  IF p_role = 'owner' THEN
    SELECT d.user_id INTO v_user FROM demo_sessions d WHERE d.tenant_id = p_tenant_id;
    RETURN v_user;
  END IF;
  IF p_role NOT IN ('accountant', 'viewer') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('demo_member:' || p_tenant_id));
  SELECT m.user_id INTO v_user
  FROM tenant_memberships m JOIN users u ON u.id = m.user_id
  WHERE m.tenant_id = p_tenant_id AND m.role = p_role::tenant_role AND u.is_demo
  LIMIT 1;
  IF v_user IS NOT NULL THEN
    RETURN v_user;
  END IF;

  v_user := gen_random_uuid();
  INSERT INTO users (id, email, name, email_verified, is_demo)
  VALUES (v_user, 'demo-' || v_user || '@demo.billanta.invalid', left(p_name, 100), now(), true);
  INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (p_tenant_id, v_user, p_role::tenant_role);
  RETURN v_user;
END;
$$;
--> statement-breakpoint
-- Arms the transfer of this demo's work; a new token replaces an older one.
CREATE OR REPLACE FUNCTION issue_demo_transfer(p_tenant_id uuid, p_token_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tenant_id::text IS DISTINCT FROM current_setting('app.current_tenant_id', true) THEN
    RAISE EXCEPTION 'demo_forbidden';
  END IF;
  UPDATE demo_sessions SET transfer_token_hash = p_token_hash
  WHERE tenant_id = p_tenant_id AND cleaned_at IS NULL AND transferred_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'demo_forbidden';
  END IF;
END;
$$;
--> statement-breakpoint
-- Redeems a transfer token once: what the visitor made in that demo, as
-- JSON, or NULL when the token is unknown, used, or its demo is gone.
-- Refuses to run from inside a demo (a demo can't collect another's work).
CREATE OR REPLACE FUNCTION claim_demo_transfer(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row demo_sessions%ROWTYPE;
  v_since timestamptz;
  v_invoices jsonb;
  v_contacts jsonb;
  v_expenses jsonb;
BEGIN
  IF tenant_is_demo(nullif(current_setting('app.current_tenant_id', true), '')::uuid) THEN
    RAISE EXCEPTION 'demo_forbidden';
  END IF;
  SELECT * INTO v_row FROM demo_sessions d
  WHERE d.transfer_token_hash = p_token_hash AND d.transferred_at IS NULL AND d.cleaned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = v_row.tenant_id AND is_demo) THEN
    RETURN NULL;
  END IF;
  UPDATE demo_sessions SET transferred_at = now(), transfer_token_hash = NULL WHERE id = v_row.id;
  v_since := coalesce(v_row.seeded_at, v_row.created_at);

  -- Credit notes are left out: they only make sense next to the invoice they correct.
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at'), '[]'::jsonb) INTO v_invoices FROM (
    SELECT jsonb_build_object(
      'document_type', i.document_type, 'contact_id', i.contact_id, 'currency', i.currency,
      'language', i.language, 'reverse_charge', i.reverse_charge, 'reverse_charge_code', i.reverse_charge_code,
      'payment_method', i.payment_method, 'order_number', i.order_number,
      'note_above', i.note_above, 'note_below', i.note_below, 'buyer_contact_person', i.buyer_contact_person,
      'created_at', i.created_at,
      'items', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'description', li.description, 'quantity', li.quantity, 'unit', li.unit, 'code', li.code,
          'unit_price', li.unit_price, 'vat_rate', li.vat_rate, 'discount_percent', li.discount_percent
        ) ORDER BY li.sort_order), '[]'::jsonb)
        FROM invoice_line_items li WHERE li.invoice_id = i.id)
    ) AS x
    FROM invoices i
    WHERE i.tenant_id = v_row.tenant_id AND i.created_at > v_since AND i.document_type <> 'credit_note'
    ORDER BY i.created_at
    LIMIT 100
  ) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'ico', c.ico, 'dic', c.dic, 'legal_name', c.legal_name, 'email', c.email, 'phone', c.phone,
      'contact_person', c.contact_person, 'address_street', c.address_street, 'address_city', c.address_city,
      'address_postal_code', c.address_postal_code, 'address_country', c.address_country,
      'is_vat_payer', c.is_vat_payer, 'is_person', c.is_person, 'internal_note', c.internal_note
    ) ORDER BY c.created_at), '[]'::jsonb) INTO v_contacts
  FROM contacts c
  WHERE c.tenant_id = v_row.tenant_id
    AND (c.created_at > v_since
         OR c.id IN (SELECT (e->>'contact_id')::uuid FROM jsonb_array_elements(v_invoices) e WHERE e->>'contact_id' IS NOT NULL));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'supplier_name_raw', e.supplier_name_raw, 'supplier_ico', e.supplier_ico, 'supplier_dic', e.supplier_dic,
      'description', e.description, 'amount', e.amount, 'vat_rate', e.vat_rate, 'currency', e.currency,
      'exchange_rate', e.exchange_rate, 'expense_date', e.expense_date, 'due_date', e.due_date, 'category', e.category,
      'document_number', e.document_number, 'variable_symbol', e.variable_symbol, 'note', e.note,
      'reverse_charge', e.reverse_charge, 'reverse_charge_code', e.reverse_charge_code
    ) ORDER BY e.created_at), '[]'::jsonb) INTO v_expenses
  FROM (SELECT * FROM expenses WHERE tenant_id = v_row.tenant_id AND created_at > v_since ORDER BY created_at LIMIT 200) e;

  RETURN jsonb_build_object('kind', v_row.kind, 'contacts', v_contacts, 'invoices', v_invoices, 'expenses', v_expenses);
END;
$$;
--> statement-breakpoint
-- As in 0068, plus the team-view users: every demo user that was a member
-- of the company goes with it.
CREATE OR REPLACE FUNCTION delete_demo_tenant(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_users uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id AND is_demo) THEN
    UPDATE demo_sessions SET cleaned_at = now() WHERE tenant_id = p_tenant_id AND cleaned_at IS NULL;
    RETURN;
  END IF;
  SELECT array_agg(m.user_id) INTO v_users FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id;
  UPDATE invoices SET related_invoice_id = NULL WHERE tenant_id = p_tenant_id AND related_invoice_id IS NOT NULL;
  DELETE FROM recurring_invoice_templates WHERE tenant_id = p_tenant_id;
  DELETE FROM invoices WHERE tenant_id = p_tenant_id;
  DELETE FROM expenses WHERE tenant_id = p_tenant_id;
  DELETE FROM invoice_number_sequences WHERE tenant_id = p_tenant_id;
  DELETE FROM tenant_bank_accounts WHERE tenant_id = p_tenant_id;
  DELETE FROM tenants WHERE id = p_tenant_id;
  DELETE FROM users u
  WHERE u.is_demo
    AND (u.id = ANY (coalesce(v_users, '{}')) OR u.id IN (SELECT d.user_id FROM demo_sessions d WHERE d.tenant_id = p_tenant_id))
    AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id);
  UPDATE demo_sessions SET cleaned_at = now() WHERE tenant_id = p_tenant_id;
  DELETE FROM demo_sessions WHERE cleaned_at < now() - interval '30 days';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mark_demo_seeded(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION demo_member(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION issue_demo_transfer(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_demo_transfer(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION mark_demo_seeded(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION demo_member(uuid, text, text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION issue_demo_transfer(uuid, text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION claim_demo_transfer(text) TO faktur_app;
  END IF;
END $$;
