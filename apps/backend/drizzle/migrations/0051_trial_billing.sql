-- Free trial of the top plan, Stripe plan tracking and plans paid by bank
-- transfer against a proforma from Billanta itself.
--
--   * tenants.trial_*: a new company gets TRIAL_DAYS of Business, granted by
--     bootstrap_tenant_for_user (rls-policies.sql) and never cleared, so the
--     same company can't start it again. trial_reminded_days remembers which
--     "ends in N days" reminder already went out.
--   * tenants.plan_enforced: plan limits apply. Companies created before this
--     migration stay false and keep everything they had.
--   * tenants.subscription_plan / subscription_interval: what the Stripe
--     subscription pays for (Checkout metadata).
--   * trial_claims: one trial per user account and per e-mail address (a
--     sha256 of the normalised address, so a deleted account leaves no
--     readable e-mail behind). Only the SECURITY DEFINER bootstrap touches it;
--     app-role-grants.sql revokes the app role's access.
--   * platform_proformas: tenant-scoped, the company sees its own. Marked paid
--     only through mark_platform_proforma_paid (platform admins), which also
--     extends tenants.prepaid_plan / prepaid_until.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_plan" varchar(16);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_reminded_days" integer;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "plan_enforced" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_plan" varchar(16);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_interval" varchar(8);
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_subscription_interval_check";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_subscription_interval_check" CHECK ("subscription_interval" IS NULL OR "subscription_interval" IN ('month', 'year'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_trial_ends_idx" ON "tenants" ("trial_ends_at") WHERE "trial_ends_at" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- No foreign keys: the claim has to outlive a deleted account or company.
  "user_id" uuid NOT NULL,
  "email_hash" varchar(64) NOT NULL,
  "tenant_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_claims_user_unique" ON "trial_claims" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_claims_email_unique" ON "trial_claims" ("email_hash");
--> statement-breakpoint
-- Normalised for the one-trial-per-address check: lower case, no "+tag", and
-- for Gmail no dots, so jan.novak+2@gmail.com counts as janovak@gmail.com.
CREATE OR REPLACE FUNCTION trial_email_key(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN split_part(e, '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(split_part(e, '@', 1), '+', 1), '.', '') || '@gmail.com'
    ELSE split_part(split_part(e, '@', 1), '+', 1) || '@' || split_part(e, '@', 2)
  END
  FROM (SELECT lower(btrim(p_email)) AS e) s
$$;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "platform_proforma_seq";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_proformas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "number" varchar(20) NOT NULL,
  "variable_symbol" varchar(10) NOT NULL CHECK ("variable_symbol" ~ '^[0-9]{1,10}$'),
  "plan" varchar(16) NOT NULL CHECK ("plan" IN ('start', 'plus', 'business')),
  "months" integer NOT NULL CHECK ("months" IN (1, 12)),
  "currency" varchar(3) NOT NULL DEFAULT 'CZK',
  "amount_minor" integer NOT NULL CHECK ("amount_minor" > 0),
  "vat_rate" integer NOT NULL DEFAULT 0 CHECK ("vat_rate" BETWEEN 0 AND 30),
  "total_minor" integer NOT NULL CHECK ("total_minor" >= "amount_minor"),
  "status" varchar(10) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'paid', 'canceled')),
  "due_date" date NOT NULL,
  "created_by_user_id" uuid,
  "paid_at" timestamp with time zone,
  "paid_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_proformas_number_unique" ON "platform_proformas" ("number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_proformas_vs_unique" ON "platform_proformas" ("variable_symbol");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_proformas_tenant_idx" ON "platform_proformas" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_proformas_pending_idx" ON "platform_proformas" ("created_at" DESC) WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "platform_proformas" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_proformas" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS platform_proformas_read ON "platform_proformas";
--> statement-breakpoint
CREATE POLICY platform_proformas_read ON "platform_proformas" FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
-- A company can only ask for a pending proforma; "paid" comes from the admin function.
DROP POLICY IF EXISTS platform_proformas_request ON "platform_proformas";
--> statement-breakpoint
CREATE POLICY platform_proformas_request ON "platform_proformas" FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid AND status = 'pending' AND paid_at IS NULL);
--> statement-breakpoint
-- Platform admins (src/billing/admin-billing.controller.ts): every company's
-- proformas, newest first, with just enough of the company to match a payment.
DROP FUNCTION IF EXISTS list_platform_proformas(text);
--> statement-breakpoint
CREATE FUNCTION list_platform_proformas(p_status text)
RETURNS TABLE (
  id uuid, tenant_id uuid, company_name text, ico varchar, number varchar, variable_symbol varchar,
  plan varchar, months integer, currency varchar, total_minor integer, status varchar,
  due_date date, created_at timestamptz, paid_at timestamptz, paid_by text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.tenant_id, t.company_name, t.ico, p.number, p.variable_symbol,
         p.plan, p.months, p.currency, p.total_minor, p.status,
         p.due_date, p.created_at, p.paid_at, p.paid_by
  FROM platform_proformas p
  JOIN tenants t ON t.id = p.tenant_id
  WHERE p_status IS NULL OR p.status = p_status
  ORDER BY p.created_at DESC
  LIMIT 500
$$;
--> statement-breakpoint
-- The money for proforma p_id arrived: mark it paid and extend the company's
-- prepaid plan (from the end of a running prepaid period of the same plan,
-- otherwise from today). result: 'paid', 'not_found' or 'not_pending', so a
-- double click never extends twice.
DROP FUNCTION IF EXISTS mark_platform_proforma_paid(uuid, text);
--> statement-breakpoint
CREATE FUNCTION mark_platform_proforma_paid(p_id uuid, p_admin text)
RETURNS TABLE (result text, tenant_id uuid, plan varchar, prepaid_until date)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p platform_proformas%ROWTYPE;
  v_plan varchar;
  v_until date;
  v_from date;
BEGIN
  SELECT * INTO p FROM platform_proformas WHERE platform_proformas.id = p_id FOR UPDATE;
  IF p.id IS NULL THEN
    result := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF p.status <> 'pending' THEN
    result := 'not_pending';
    tenant_id := p.tenant_id;
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT t.prepaid_plan, t.prepaid_until INTO v_plan, v_until FROM tenants t WHERE t.id = p.tenant_id FOR UPDATE;
  v_from := CASE WHEN v_plan = p.plan AND v_until >= current_date THEN v_until ELSE current_date END;
  v_until := (v_from + make_interval(months => p.months))::date;
  UPDATE platform_proformas SET status = 'paid', paid_at = now(), paid_by = left(p_admin, 200) WHERE platform_proformas.id = p.id;
  UPDATE tenants SET prepaid_plan = p.plan, prepaid_until = v_until, updated_at = now() WHERE tenants.id = p.tenant_id;
  result := 'paid';
  tenant_id := p.tenant_id;
  plan := p.plan;
  prepaid_until := v_until;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_platform_proformas(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mark_platform_proforma_paid(uuid, text) FROM PUBLIC;
--> statement-breakpoint
-- The trial-granting bootstrap gains a p_trial_days argument. Drop the old
-- four-argument version first, otherwise a four-argument call would match
-- both. rls-policies.sql (re-run after every migrate) holds the same body.
DROP FUNCTION IF EXISTS bootstrap_tenant_for_user(uuid, text, text, text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bootstrap_tenant_for_user(
  p_user_id uuid,
  p_company_name text,
  p_tos_version text,
  p_ip_address text DEFAULT NULL,
  p_trial_days integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_tos_version_id uuid;
  v_email text;
  v_days integer := least(greatest(coalesce(p_trial_days, 0), 0), 90);
  v_claim uuid;
BEGIN
  IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
    RAISE EXCEPTION 'company name is required';
  END IF;

  INSERT INTO tos_versions (version, content_hash)
  VALUES (p_tos_version, md5('placeholder:' || p_tos_version))
  ON CONFLICT (version) DO NOTHING;

  SELECT id INTO v_tos_version_id FROM tos_versions WHERE version = p_tos_version;

  INSERT INTO tenants (company_name, legal_name, plan_enforced)
  VALUES (btrim(p_company_name), btrim(p_company_name), true)
  RETURNING id INTO v_tenant_id;

  INSERT INTO tenant_memberships (tenant_id, user_id, role)
  VALUES (v_tenant_id, p_user_id, 'owner');

  INSERT INTO tos_acceptances (user_id, tenant_id, tos_version_id, ip_address)
  VALUES (p_user_id, v_tenant_id, v_tos_version_id, p_ip_address);

  -- One trial per user account and per e-mail address, whichever was used first.
  IF v_days > 0 THEN
    SELECT email INTO v_email FROM users WHERE id = p_user_id;
    IF v_email IS NOT NULL THEN
      INSERT INTO trial_claims (user_id, email_hash, tenant_id)
      VALUES (p_user_id, encode(sha256(convert_to(trial_email_key(v_email), 'UTF8')), 'hex'), v_tenant_id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_claim;
      IF v_claim IS NOT NULL THEN
        UPDATE tenants
          SET trial_plan = 'business', trial_started_at = now(), trial_ends_at = now() + make_interval(days => v_days)
          WHERE id = v_tenant_id;
      END IF;
    END IF;
  END IF;

  RETURN v_tenant_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION bootstrap_tenant_for_user(uuid, text, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    REVOKE ALL ON "trial_claims" FROM faktur_app;
    GRANT SELECT, INSERT ON "platform_proformas" TO faktur_app;
    GRANT USAGE, SELECT ON SEQUENCE "platform_proforma_seq" TO faktur_app;
    GRANT EXECUTE ON FUNCTION list_platform_proformas(text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION mark_platform_proforma_paid(uuid, text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION bootstrap_tenant_for_user(uuid, text, text, text, integer) TO faktur_app;
  END IF;
END $$;
