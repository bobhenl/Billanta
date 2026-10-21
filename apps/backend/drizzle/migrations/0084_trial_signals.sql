-- Abuse signals and a card extension for the welcome trial, which is now
-- 7 days of Plus (DEFAULT_TRIAL_DAYS, plans.ts), still started by the first
-- IČO checked in ARES / RPO and still once per IČO (0082).
--
--   * trial_signals: sha256 of the bank accounts, e-mails, phones and
--     sign-up IP of every company that had a trial (welcome-trial.ts
--     normalises and hashes them). A bank account, e-mail or phone another
--     trial company had, or a sign-up IP shared with two other trial
--     companies in 30 days, withholds the no-card trial or ends a running
--     one. The account is never blocked.
--   * trial_cards: one card extension per Stripe card fingerprint (hashed).
--     A card makes the trial 30 days from its start and clears a withheld
--     trial or an IČO someone else already used. Nothing is charged.
--   * tenants.trial_source ('welcome' | 'card', null for promo codes and
--     trials from before this migration, which a signal never ends) and tenants.trial_withheld_at (the card offer shows).
--
-- Backfill: IBANs and sign-up IPs of companies that already had a trial;
-- e-mails and phones need the TS normalisation and start empty. The app
-- role cannot read or write either table (app-role-grants.sql).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_source" varchar(8);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_withheld_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_signals" (
  "kind" varchar(8) NOT NULL,
  "value_hash" varchar(64) NOT NULL,
  "tenant_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("kind", "value_hash", "tenant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_cards" (
  "card_hash" varchar(64) PRIMARY KEY NOT NULL,
  "tenant_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
REVOKE ALL ON "trial_signals" FROM faktur_app;
--> statement-breakpoint
REVOKE ALL ON "trial_cards" FROM faktur_app;
--> statement-breakpoint
INSERT INTO trial_signals (kind, value_hash, tenant_id, created_at)
SELECT DISTINCT 'bank', encode(sha256(convert_to('bank:' || iban, 'UTF8')), 'hex'), id, trial_started_at
FROM (
  SELECT t.id, t.trial_started_at, upper(regexp_replace(t.bank_account_iban, '[\s-]+', '', 'g')) AS iban
  FROM tenants t WHERE t.trial_started_at IS NOT NULL
  UNION ALL
  SELECT t.id, t.trial_started_at, upper(regexp_replace(b.iban, '[\s-]+', '', 'g'))
  FROM tenants t JOIN tenant_bank_accounts b ON b.tenant_id = t.id WHERE t.trial_started_at IS NOT NULL
) x
WHERE iban ~ '^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO trial_signals (kind, value_hash, tenant_id, created_at)
SELECT DISTINCT 'ip', encode(sha256(convert_to('ip:' || lower(btrim(a.ip_address)), 'UTF8')), 'hex'), t.id, t.trial_started_at
FROM tenants t JOIN tos_acceptances a ON a.tenant_id = t.id
WHERE t.trial_started_at IS NOT NULL AND a.ip_address ~ '^\d{1,3}(\.\d{1,3}){3}$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trial_signal_hit(p_tenant_id uuid, p_signals jsonb, p_with_ip boolean)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_to_recordset(coalesce(p_signals, '[]'::jsonb)) AS x(kind text, hash text)
      JOIN trial_signals s ON s.kind = x.kind AND s.value_hash = x.hash
      WHERE x.kind = 'bank' AND s.tenant_id <> p_tenant_id
    ) THEN 'signal_bank'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_to_recordset(coalesce(p_signals, '[]'::jsonb)) AS x(kind text, hash text)
      JOIN trial_signals s ON s.kind = x.kind AND s.value_hash = x.hash
      WHERE x.kind IN ('email', 'phone') AND s.tenant_id <> p_tenant_id
    ) THEN 'signal_contact'
    WHEN p_with_ip AND (
      SELECT count(DISTINCT s.tenant_id)
      FROM jsonb_to_recordset(coalesce(p_signals, '[]'::jsonb)) AS x(kind text, hash text)
      JOIN trial_signals s ON s.kind = x.kind AND s.value_hash = x.hash
      WHERE x.kind = 'ip' AND s.tenant_id <> p_tenant_id AND s.created_at > now() - interval '30 days'
    ) >= 2 THEN 'signal_ip'
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION trial_signal_hit(uuid, jsonb, boolean) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trial_record_signals(p_tenant_id uuid, p_signals jsonb)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO trial_signals (kind, value_hash, tenant_id)
  SELECT DISTINCT x.kind, x.hash, p_tenant_id
  FROM jsonb_to_recordset(coalesce(p_signals, '[]'::jsonb)) AS x(kind text, hash text)
  WHERE x.kind IN ('bank', 'email', 'phone', 'ip') AND x.hash ~ '^[0-9a-f]{64}$'
  ON CONFLICT DO NOTHING
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION trial_record_signals(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
DROP FUNCTION IF EXISTS grant_welcome_trial(uuid, integer);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION grant_welcome_trial(p_tenant_id uuid, p_trial_days integer, p_signals jsonb)
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
  v_hit text;
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
    -- Someone else's trial, or a squatter's: a card clears it.
    UPDATE tenants SET trial_withheld_at = coalesce(trial_withheld_at, now()) WHERE id = p_tenant_id;
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

  v_hit := trial_signal_hit(p_tenant_id, p_signals, true);
  IF v_hit IS NOT NULL THEN
    UPDATE tenants SET trial_withheld_at = coalesce(trial_withheld_at, now()) WHERE id = p_tenant_id;
    RETURN v_hit;
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

  PERFORM trial_record_signals(p_tenant_id, p_signals);
  UPDATE tenants
    SET trial_plan = 'plus', trial_started_at = now(), trial_ends_at = now() + make_interval(days => v_days),
        trial_reminded_days = NULL, trial_source = 'welcome', trial_withheld_at = NULL
    WHERE id = p_tenant_id;
  RETURN 'granted';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION grant_welcome_trial(uuid, integer, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION grant_welcome_trial(uuid, integer, jsonb) TO faktur_app;
--> statement-breakpoint
-- After a company that had a trial changes its bank accounts or contacts:
-- records the new values, and ends a running no-card welcome trial when a
-- bank, e-mail or phone belongs to another trial company. The IP is left
-- out here, it was judged at the grant. Returns 'recorded', 'ended:<signal>'
-- or why nothing was done.
CREATE OR REPLACE FUNCTION refresh_trial_signals(p_tenant_id uuid, p_signals jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant tenants%ROWTYPE;
  v_hit text;
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.current_tenant_id', true), '')::uuid THEN
    RETURN 'wrong_tenant';
  END IF;
  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_tenant.trial_started_at IS NULL OR v_tenant.is_demo OR v_tenant.classroom_class_id IS NOT NULL THEN
    RETURN 'no_trial';
  END IF;

  IF v_tenant.trial_source = 'welcome' AND v_tenant.trial_ends_at > now() THEN
    v_hit := trial_signal_hit(p_tenant_id, p_signals, false);
    IF v_hit IS NOT NULL THEN
      UPDATE tenants SET trial_ends_at = now(), trial_withheld_at = now() WHERE id = p_tenant_id;
      RETURN 'ended:' || v_hit;
    END IF;
  END IF;

  PERFORM trial_record_signals(p_tenant_id, p_signals);
  RETURN 'recorded';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION refresh_trial_signals(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION refresh_trial_signals(uuid, jsonb) TO faktur_app;
--> statement-breakpoint
-- A card saved in Stripe (setup mode, nothing charged) makes the trial
-- p_total_days long from its start, once per company and once per card
-- (trial_cards keeps a hash of Stripe's card fingerprint). It also clears a
-- withheld trial (a signal hit or an IČO that already had one), but not an
-- owner who had a trial on another company. Called by
-- WelcomeTrialService.extendWithCard after the app checked the IČO in ARES / RPO.
CREATE OR REPLACE FUNCTION extend_trial_with_card(p_tenant_id uuid, p_card_hash text, p_total_days integer, p_signals jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := least(greatest(coalesce(p_total_days, 0), 0), 90);
  v_tenant tenants%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
  v_owner uuid;
  v_email text;
BEGIN
  IF v_days = 0 OR p_card_hash IS NULL OR p_card_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN 'trial_off';
  END IF;
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.current_tenant_id', true), '')::uuid THEN
    RETURN 'wrong_tenant';
  END IF;

  SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_tenant.is_demo OR v_tenant.classroom_class_id IS NOT NULL THEN
    RETURN 'not_eligible';
  END IF;
  IF v_tenant.trial_source = 'card' THEN
    RETURN 'already_extended';
  END IF;
  IF v_tenant.ico IS NULL OR v_tenant.ico !~ '^\d{8}$' THEN
    RETURN 'no_ico';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id
    JOIN trial_claims c
      ON c.user_id = u.id
      OR c.email_hash = encode(sha256(convert_to(trial_email_key(u.email), 'UTF8')), 'hex')
    WHERE m.tenant_id = p_tenant_id AND m.role = 'owner' AND c.tenant_id IS DISTINCT FROM p_tenant_id
  ) THEN
    RETURN 'user_had_trial';
  END IF;

  v_start := coalesce(v_tenant.trial_started_at, now());
  v_end := greatest(v_start + make_interval(days => v_days), v_tenant.trial_ends_at);
  IF v_end <= now() THEN
    RETURN 'trial_over';
  END IF;

  INSERT INTO trial_cards (card_hash, tenant_id) VALUES (p_card_hash, p_tenant_id)
  ON CONFLICT (card_hash) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'card_used';
  END IF;

  -- A squatted IČO stays with the first company; this one is let through.
  INSERT INTO trial_icos (ico, tenant_id) VALUES (v_tenant.ico, p_tenant_id)
  ON CONFLICT (ico) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM trial_claims WHERE tenant_id = p_tenant_id) THEN
    SELECT m.user_id, u.email INTO v_owner, v_email
    FROM tenant_memberships m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN tos_acceptances a ON a.tenant_id = m.tenant_id AND a.user_id = m.user_id
    WHERE m.tenant_id = p_tenant_id AND m.role = 'owner' AND NOT u.is_demo
    ORDER BY (a.user_id IS NULL), m.user_id
    LIMIT 1;
    IF v_owner IS NOT NULL AND v_email IS NOT NULL THEN
      INSERT INTO trial_claims (user_id, email_hash, tenant_id)
      VALUES (v_owner, encode(sha256(convert_to(trial_email_key(v_email), 'UTF8')), 'hex'), p_tenant_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  PERFORM trial_record_signals(p_tenant_id, p_signals);
  UPDATE tenants
    SET trial_plan = coalesce(trial_plan, 'plus'), trial_started_at = v_start, trial_ends_at = v_end,
        trial_reminded_days = NULL, trial_source = 'card', trial_withheld_at = NULL
    WHERE id = p_tenant_id;
  RETURN 'extended';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION extend_trial_with_card(uuid, text, integer, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION extend_trial_with_card(uuid, text, integer, jsonb) TO faktur_app;
