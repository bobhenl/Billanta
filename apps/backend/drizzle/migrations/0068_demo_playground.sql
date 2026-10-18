-- Demo playground (docs/demo-playground-plan.md): a visitor picks an account
-- type on /demo and gets a private copy of a fictional company for 24 hours.
--
-- A demo is a real tenant (is_demo) with a real, password-less user
-- (users.is_demo, an address under the reserved .invalid TLD), so the whole
-- app works on it unchanged. What must never happen from a demo is enforced
-- here, below the API, so a missed check in a controller can't open it up:
--   - the supplier identity (name, IČO, DIČ, address, bank accounts) is
--     locked, so a demo can't print documents in someone else's name;
--   - nothing leaves the system: no e-mail, invitations, API keys, channel
--     links, backups, bank connections or card payments;
--   - row caps keep one visitor from filling the database.
-- The triggers act only for faktur_app (the API). The SECURITY DEFINER
-- functions below run as the owner and set the demo up and tear it down.
--
-- demo_sessions holds the per-IP bookkeeping (a salted hash, never the IP)
-- and is invisible to faktur_app; it is read and written only through the
-- functions here.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "is_demo" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "demo_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "demo_kind" text;
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_demo_kind_check";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_demo_kind_check"
  CHECK ("demo_kind" IS NULL OR "demo_kind" IN ('cz_vat_sro', 'cz_freelancer', 'cz_pausal', 'sk_vat_sro'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_demo_expires_idx" ON "tenants" ("demo_expires_at") WHERE "is_demo";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_demo" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "demo_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "ip_bucket" char(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "ai_calls" integer DEFAULT 0 NOT NULL,
  "cleanup_started_at" timestamp with time zone,
  "cleaned_at" timestamp with time zone
);
--> statement-breakpoint
-- No FK to tenants: the row outlives the tenant (per-IP limits count the
-- last 24 h of demos, cleaned up or not) and is purged after 30 days.
CREATE UNIQUE INDEX IF NOT EXISTS "demo_sessions_tenant_unique" ON "demo_sessions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_sessions_ip_created_idx" ON "demo_sessions" ("ip_bucket", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_sessions_expires_idx" ON "demo_sessions" ("expires_at") WHERE "cleaned_at" IS NULL;
--> statement-breakpoint
-- RLS on without a policy: nothing but the owner (the functions below) sees a row.
ALTER TABLE "demo_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "demo_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION tenant_is_demo(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT is_demo FROM tenants WHERE id = p_tenant_id), false);
$$;
--> statement-breakpoint
-- Creates the demo company, its user and owner membership in one go. The
-- advisory lock serialises creations, so the per-IP and capacity counts
-- can't be raced past. p_tenant and p_bank come from the backend's own
-- dataset (src/demo/dataset), never from the visitor.
CREATE OR REPLACE FUNCTION create_demo_tenant(
  p_kind text,
  p_ip_bucket text,
  p_ttl_hours integer,
  p_per_ip_daily integer,
  p_max_active integer,
  p_tenant jsonb,
  p_bank jsonb
)
RETURNS TABLE (tenant_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid := gen_random_uuid();
  v_expires timestamptz := now() + make_interval(hours => p_ttl_hours);
  v_bank jsonb;
  v_sort integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('demo_create'));

  IF (SELECT count(*) FROM demo_sessions d
      WHERE d.ip_bucket = p_ip_bucket AND d.created_at > now() - interval '24 hours') >= p_per_ip_daily THEN
    RAISE EXCEPTION 'demo_ip_limit';
  END IF;
  IF (SELECT count(*) FROM demo_sessions d WHERE d.cleaned_at IS NULL) >= p_max_active THEN
    RAISE EXCEPTION 'demo_capacity';
  END IF;

  INSERT INTO users (id, email, name, email_verified, is_demo)
  VALUES (v_user, 'demo-' || v_user || '@demo.billanta.invalid', p_tenant->>'owner_name', now(), true);

  INSERT INTO tenants (
    company_name, legal_name, ico, dic, vat_status, dic_vat_payer, flat_tax_regime, activity_kind,
    address_street, address_city, address_postal_code, address_country, default_locale,
    email, phone, website, registry_note,
    bank_account_number, bank_account_bank_code, bank_account_iban, bank_account_swift,
    ai_mode, plan_enforced, is_demo, demo_kind, demo_expires_at
  ) VALUES (
    p_tenant->>'company_name', p_tenant->>'legal_name', p_tenant->>'ico', p_tenant->>'dic',
    (p_tenant->>'vat_status')::vat_status, (p_tenant->>'vat_status') = 'payer',
    (p_tenant->>'flat_tax_regime')::boolean, p_tenant->>'activity_kind',
    p_tenant->>'address_street', p_tenant->>'address_city', p_tenant->>'address_postal_code',
    p_tenant->>'address_country', p_tenant->>'default_locale',
    p_tenant->>'email', p_tenant->>'phone', p_tenant->>'website', p_tenant->>'registry_note',
    p_tenant->>'bank_account_number', p_tenant->>'bank_account_bank_code',
    p_tenant->>'bank_account_iban', p_tenant->>'bank_account_swift',
    'platform', false, true, p_kind, v_expires
  )
  RETURNING id INTO v_tenant;

  INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (v_tenant, v_user, 'owner');

  FOR v_bank IN SELECT * FROM jsonb_array_elements(coalesce(p_bank, '[]'::jsonb)) LOOP
    INSERT INTO tenant_bank_accounts (tenant_id, label, account_number, bank_code, iban, swift, currency, sort_order)
    VALUES (v_tenant, v_bank->>'label', v_bank->>'account_number', v_bank->>'bank_code',
            v_bank->>'iban', v_bank->>'swift', v_bank->>'currency', v_sort);
    v_sort := v_sort + 1;
  END LOOP;

  INSERT INTO demo_sessions (tenant_id, user_id, kind, ip_bucket, expires_at)
  VALUES (v_tenant, v_user, p_kind, p_ip_bucket, v_expires);

  RETURN QUERY SELECT v_tenant, v_user, v_expires;
END;
$$;
--> statement-breakpoint
-- One AI call from a demo: counts it and returns how many are left, or -1
-- (nothing counted) when the demo or the visitor's IP has used its quota.
CREATE OR REPLACE FUNCTION consume_demo_ai_call(p_tenant_id uuid, p_per_session integer, p_per_ip integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row demo_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM demo_sessions d WHERE d.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_row.ai_calls >= p_per_session THEN
    RETURN -1;
  END IF;
  IF (SELECT coalesce(sum(d.ai_calls), 0) FROM demo_sessions d
      WHERE d.ip_bucket = v_row.ip_bucket AND d.created_at > now() - interval '24 hours') >= p_per_ip THEN
    RETURN -1;
  END IF;
  UPDATE demo_sessions SET ai_calls = ai_calls + 1 WHERE id = v_row.id;
  RETURN p_per_session - v_row.ai_calls - 1;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION demo_ai_calls_left(p_tenant_id uuid, p_per_session integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT greatest(0, p_per_session - coalesce((SELECT ai_calls FROM demo_sessions WHERE tenant_id = p_tenant_id), p_per_session));
$$;
--> statement-breakpoint
-- The cleanup cron's work list: expired demos nobody is cleaning up, or
-- whose cleanup started more than p_grace ago and evidently died.
CREATE OR REPLACE FUNCTION claim_expired_demo_tenants(p_limit integer, p_grace interval)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE demo_sessions SET cleanup_started_at = now()
  WHERE id IN (
    SELECT id FROM demo_sessions
    WHERE cleaned_at IS NULL
      AND expires_at < now()
      AND (cleanup_started_at IS NULL OR cleanup_started_at < now() - p_grace)
    ORDER BY expires_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING tenant_id;
$$;
--> statement-breakpoint
-- Deletes one expired demo company with everything in it, then its user.
-- Refuses anything that is not a demo. The order follows the RESTRICT
-- foreign keys (same as AccountDeletionService.wipe); the rest cascades.
-- Old session rows are purged here too, so no separate job is needed.
CREATE OR REPLACE FUNCTION delete_demo_tenant(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id AND is_demo) THEN
    UPDATE demo_sessions SET cleaned_at = now() WHERE tenant_id = p_tenant_id AND cleaned_at IS NULL;
    RETURN;
  END IF;
  UPDATE invoices SET related_invoice_id = NULL WHERE tenant_id = p_tenant_id AND related_invoice_id IS NOT NULL;
  DELETE FROM recurring_invoice_templates WHERE tenant_id = p_tenant_id;
  DELETE FROM invoices WHERE tenant_id = p_tenant_id;
  DELETE FROM expenses WHERE tenant_id = p_tenant_id;
  DELETE FROM invoice_number_sequences WHERE tenant_id = p_tenant_id;
  DELETE FROM tenant_bank_accounts WHERE tenant_id = p_tenant_id;
  DELETE FROM tenants WHERE id = p_tenant_id;
  DELETE FROM users u
  WHERE u.is_demo
    AND u.id IN (SELECT d.user_id FROM demo_sessions d WHERE d.tenant_id = p_tenant_id)
    AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id);
  UPDATE demo_sessions SET cleaned_at = now() WHERE tenant_id = p_tenant_id;
  DELETE FROM demo_sessions WHERE cleaned_at < now() - interval '30 days';
END;
$$;
--> statement-breakpoint
-- Supplier identity, billing state and every outward-facing setting of a
-- demo company stay as created. Day-to-day settings (invoice defaults,
-- number formats, e-mail texts, modules) stay editable.
CREATE OR REPLACE FUNCTION demo_tenants_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user <> 'faktur_app' OR NOT OLD.is_demo THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'demo_locked';
  END IF;
  IF ROW(NEW.company_name, NEW.legal_name, NEW.ico, NEW.dic, NEW.dic_vat_payer, NEW.vat_status,
         NEW.flat_tax_regime, NEW.activity_kind, NEW.address_street, NEW.address_city,
         NEW.address_postal_code, NEW.address_country, NEW.email, NEW.phone, NEW.website,
         NEW.data_box_id, NEW.registry_note, NEW.logo_data, NEW.logo_mime,
         NEW.bank_account_number, NEW.bank_account_bank_code, NEW.bank_account_iban, NEW.bank_account_swift,
         NEW.payment_methods, NEW.ai_mode, NEW.ai_api_key_encrypted, NEW.stripe_secret_key_encrypted,
         NEW.card_payments_enabled, NEW.webhooks, NEW.public_profile, NEW.is_demo, NEW.demo_expires_at,
         NEW.demo_kind, NEW.plan_enforced, NEW.trial_plan, NEW.trial_started_at, NEW.trial_ends_at,
         NEW.prepaid_plan, NEW.prepaid_until, NEW.subscription_plan, NEW.subscription_status,
         NEW.subscription_plan_id, NEW.stripe_customer_id, NEW.gopay_payer_id, NEW.suspended_at,
         NEW.email_paused_at)
     IS DISTINCT FROM
     ROW(OLD.company_name, OLD.legal_name, OLD.ico, OLD.dic, OLD.dic_vat_payer, OLD.vat_status,
         OLD.flat_tax_regime, OLD.activity_kind, OLD.address_street, OLD.address_city,
         OLD.address_postal_code, OLD.address_country, OLD.email, OLD.phone, OLD.website,
         OLD.data_box_id, OLD.registry_note, OLD.logo_data, OLD.logo_mime,
         OLD.bank_account_number, OLD.bank_account_bank_code, OLD.bank_account_iban, OLD.bank_account_swift,
         OLD.payment_methods, OLD.ai_mode, OLD.ai_api_key_encrypted, OLD.stripe_secret_key_encrypted,
         OLD.card_payments_enabled, OLD.webhooks, OLD.public_profile, OLD.is_demo, OLD.demo_expires_at,
         OLD.demo_kind, OLD.plan_enforced, OLD.trial_plan, OLD.trial_started_at, OLD.trial_ends_at,
         OLD.prepaid_plan, OLD.prepaid_until, OLD.subscription_plan, OLD.subscription_status,
         OLD.subscription_plan_id, OLD.stripe_customer_id, OLD.gopay_payer_id, OLD.suspended_at,
         OLD.email_paused_at) THEN
    RAISE EXCEPTION 'demo_locked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS demo_tenants_lock ON tenants;
--> statement-breakpoint
CREATE TRIGGER demo_tenants_lock BEFORE UPDATE OR DELETE ON tenants
  FOR EACH ROW EXECUTE FUNCTION demo_tenants_lock();
--> statement-breakpoint
-- Bank accounts are part of the supplier identity (they go on the QR code),
-- and the outward-facing tables are closed for demos altogether.
CREATE OR REPLACE FUNCTION demo_tenant_readonly()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'faktur_app' AND tenant_is_demo(coalesce(NEW.tenant_id, OLD.tenant_id)) THEN
    RAISE EXCEPTION '%', TG_ARGV[0];
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS demo_readonly ON tenant_bank_accounts;
--> statement-breakpoint
CREATE TRIGGER demo_readonly BEFORE INSERT OR UPDATE OR DELETE ON tenant_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION demo_tenant_readonly('demo_locked');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_invitations', 'api_keys', 'channel_links', 'backup_destinations',
                           'bank_connections', 'card_payment_sessions', 'outbound_emails', 'invoice_attachments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS demo_readonly ON %I', t);
    EXECUTE format('CREATE TRIGGER demo_readonly BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION demo_tenant_readonly(%L)', t, 'demo_disabled');
  END LOOP;
END $$;
--> statement-breakpoint
-- Row caps; the count runs under the caller's RLS, i.e. within the demo.
CREATE OR REPLACE FUNCTION demo_row_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  IF current_user = 'faktur_app' AND tenant_is_demo(NEW.tenant_id) THEN
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = $1', TG_TABLE_NAME) INTO v_count USING NEW.tenant_id;
    IF v_count >= TG_ARGV[0]::integer THEN
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
  FOR c IN SELECT * FROM (VALUES ('invoices', 100), ('contacts', 200), ('expenses', 200),
                                 ('time_entries', 500), ('bank_transactions', 300)) AS v(tbl, cap) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS demo_row_cap ON %I', c.tbl);
    EXECUTE format('CREATE TRIGGER demo_row_cap BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION demo_row_cap(%L)', c.tbl, c.cap);
  END LOOP;
END $$;
--> statement-breakpoint
-- The outbox is the one door every e-mail goes through, the frontend's
-- account e-mails included. A demo's e-mail is dropped silently (whoever
-- enqueued it gets no row back), for any role.
CREATE OR REPLACE FUNCTION demo_email_outbox_drop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.recipient) LIKE '%@demo.billanta.invalid' OR (NEW.tenant_id IS NOT NULL AND tenant_is_demo(NEW.tenant_id)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS demo_email_outbox_drop ON email_outbox;
--> statement-breakpoint
CREATE TRIGGER demo_email_outbox_drop BEFORE INSERT ON email_outbox
  FOR EACH ROW EXECUTE FUNCTION demo_email_outbox_drop();
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_is_demo(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION create_demo_tenant(text, text, integer, integer, integer, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION consume_demo_ai_call(uuid, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION demo_ai_calls_left(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_expired_demo_tenants(integer, interval) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION delete_demo_tenant(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION tenant_is_demo(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION create_demo_tenant(text, text, integer, integer, integer, jsonb, jsonb) TO faktur_app;
    GRANT EXECUTE ON FUNCTION consume_demo_ai_call(uuid, integer, integer) TO faktur_app;
    GRANT EXECUTE ON FUNCTION demo_ai_calls_left(uuid, integer) TO faktur_app;
    GRANT EXECUTE ON FUNCTION claim_expired_demo_tenants(integer, interval) TO faktur_app;
    GRANT EXECUTE ON FUNCTION delete_demo_tenant(uuid) TO faktur_app;
    REVOKE ALL ON demo_sessions FROM faktur_app;
  END IF;
END $$;
