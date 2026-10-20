-- The welcome trial a new company gets is Plus instead of Business
-- (TRIAL_PLAN in src/billing/plans.ts). Plus is what most companies end up
-- paying for, so the trial shows what they would buy and the step down to
-- Free when it ends is smaller.
--
-- Only bootstrap_tenant_for_user changes: same signature, same one trial per
-- user account and per e-mail (trial_claims), so a second company of the
-- same person still starts on Free. Companies already in a Business trial
-- keep it until it ends; nothing is rewritten for them. CREATE OR REPLACE
-- keeps the existing EXECUTE grant to faktur_app.
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
          SET trial_plan = 'plus', trial_started_at = now(), trial_ends_at = now() + make_interval(days => v_days)
          WHERE id = v_tenant_id;
      END IF;
    END IF;
  END IF;

  RETURN v_tenant_id;
END;
$$;
