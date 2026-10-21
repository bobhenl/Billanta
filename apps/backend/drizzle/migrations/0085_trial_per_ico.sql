-- The welcome trial is granted once per IČO ever, not once per sign-up.
-- People were creating account after account to stay on a free Plus; a new
-- e-mail is free, a new IČO is not.
--
--   * bootstrap_tenant_for_user no longer starts a trial. p_trial_days stays
--     in the signature (DEFAULT 0, ignored) so old callers keep working.
--   * grant_welcome_trial(tenant, days) starts it when the company first
--     saves an IČO that the app has checked against ARES / RPO
--     (billing/welcome-trial.service.ts), counted from that moment.
--   * trial_icos: one row per IČO that has had a trial. No foreign key, so
--     the row outlives the company. Backfilled from every company that ever
--     had a trial (welcome or promo code) and has an IČO.
--   * trial_claims (0051) still allows one trial per user account and per
--     e-mail, now checked for every owner of the company.
--
-- Demo and classroom companies never get one. The app role cannot read or
-- write trial_icos (app-role-grants.sql).
CREATE TABLE IF NOT EXISTS "trial_icos" (
  "ico" varchar(8) PRIMARY KEY NOT NULL,
  "tenant_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO trial_icos (ico, tenant_id, created_at)
SELECT DISTINCT ON (ico) ico, id, trial_started_at
FROM tenants
WHERE trial_started_at IS NOT NULL AND ico ~ '^\d{8}$'
ORDER BY ico, trial_started_at
ON CONFLICT (ico) DO NOTHING;
--> statement-breakpoint
REVOKE ALL ON "trial_icos" FROM faktur_app;
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

  RETURN v_tenant_id;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION grant_welcome_trial(p_tenant_id uuid, p_trial_days integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := least(greatest(coalesce(p_trial_days, 0), 0), 90);
  v_tenant tenants%ROWTYPE;
  v_owner uuid;
  v_email text;
  v_ico text;
  v_claim uuid;
BEGIN
  IF v_days = 0 THEN
    RETURN 'trial_off';
  END IF;
  -- Only for the company of the current request.
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.current_tenant_id', true), '')::uuid THEN
    RETURN 'wrong_tenant';
  END IF;

  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_tenant.is_demo OR v_tenant.classroom_class_id IS NOT NULL THEN
    RETURN 'not_eligible';
  END IF;
  IF v_tenant.trial_started_at IS NOT NULL THEN
    RETURN 'tenant_had_trial';
  END IF;
  IF v_tenant.ico IS NULL OR v_tenant.ico !~ '^\d{8}$' THEN
    RETURN 'no_ico';
  END IF;
  v_ico := v_tenant.ico;

  IF EXISTS (SELECT 1 FROM trial_icos WHERE ico = v_ico) THEN
    RETURN 'ico_had_trial';
  END IF;

  -- Any owner who already had a trial (by account or e-mail) blocks it.
  IF EXISTS (
    SELECT 1
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id
    JOIN trial_claims c
      ON c.user_id = u.id
      OR c.email_hash = encode(sha256(convert_to(trial_email_key(u.email), 'UTF8')), 'hex')
    WHERE m.tenant_id = p_tenant_id AND m.role = 'owner'
  ) THEN
    RETURN 'user_had_trial';
  END IF;

  -- The claim goes to the owner who created the company (accepted the terms for it).
  SELECT m.user_id, u.email INTO v_owner, v_email
  FROM tenant_memberships m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN tos_acceptances a ON a.tenant_id = m.tenant_id AND a.user_id = m.user_id
  WHERE m.tenant_id = p_tenant_id AND m.role = 'owner' AND NOT u.is_demo
  ORDER BY (a.user_id IS NULL), m.user_id
  LIMIT 1;
  IF v_owner IS NULL OR v_email IS NULL THEN
    RETURN 'not_eligible';
  END IF;

  INSERT INTO trial_icos (ico, tenant_id) VALUES (v_ico, p_tenant_id)
  ON CONFLICT (ico) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'ico_had_trial';
  END IF;

  INSERT INTO trial_claims (user_id, email_hash, tenant_id)
  VALUES (v_owner, encode(sha256(convert_to(trial_email_key(v_email), 'UTF8')), 'hex'), p_tenant_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_claim;
  IF v_claim IS NULL THEN
    -- Lost a race with another company of the same person.
    DELETE FROM trial_icos WHERE ico = v_ico AND tenant_id = p_tenant_id;
    RETURN 'user_had_trial';
  END IF;

  UPDATE tenants
    SET trial_plan = 'plus', trial_started_at = now(), trial_ends_at = now() + make_interval(days => v_days), trial_reminded_days = NULL
    WHERE id = p_tenant_id;
  RETURN 'granted';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION grant_welcome_trial(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION grant_welcome_trial(uuid, integer) TO faktur_app;
