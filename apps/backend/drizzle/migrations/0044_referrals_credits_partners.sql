-- Referral programme ("Pozvěte firmu, získejte kredity"), the credit wallet
-- credits are spent from, and the public partners directory.
--
--   * tenants.referral_code: the company's invite code (/signup?ref=CODE),
--     created lazily by ReferralsService. referral_program: 'friend' or
--     'accountant' (the accountant/partner programme pays more per client).
--   * referrals: one row per invited company, OWNED BY THE INVITER
--     (tenant_id), so the inviter sees its own invitations under RLS. Rows
--     are written only by the SECURITY DEFINER functions below.
--   * credit_ledger: signed credit movements per company (1 credit = 1 Kč).
--     Grants (positive) only come from the functions below; the app role may
--     only insert spends (negative) for its own tenant, and nothing can be
--     changed or deleted afterwards.
--   * tenants.prepaid_plan / prepaid_until: a plan paid with credits.
--   * partners: GLOBAL catalogue (no tenant, no RLS), like subscription_plans,
--     managed by platform admins (PLATFORM_ADMIN_EMAILS).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "referral_code" varchar(12);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "referral_program" varchar(16) DEFAULT 'friend' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_referral_program_check";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_referral_program_check" CHECK ("referral_program" IN ('friend', 'accountant'));
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "prepaid_plan" varchar(16);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "prepaid_until" date;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_referral_code_unique" ON "tenants" ("referral_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "referred_tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "program" varchar(16) NOT NULL,
  "rewarded_at" timestamp with time zone,
  "reward_credits" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_referred_unique" ON "referrals" ("referred_tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_tenant_idx" ON "referrals" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referrals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS referrals_read ON "referrals";
--> statement-breakpoint
CREATE POLICY referrals_read ON "referrals" FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "amount" integer NOT NULL CHECK ("amount" <> 0),
  "reason" varchar(32) NOT NULL CHECK ("reason" IN ('referral_welcome', 'referral_reward', 'plan_purchase', 'adjustment')),
  "referral_id" uuid REFERENCES "referrals"("id") ON DELETE SET NULL,
  "plan" varchar(16),
  "months" smallint,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_tenant_idx" ON "credit_ledger" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
-- A referral pays each side at most once, even if a webhook is replayed.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_referral_reason_unique" ON "credit_ledger" ("referral_id", "reason") WHERE "referral_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS credit_ledger_read ON "credit_ledger";
--> statement-breakpoint
CREATE POLICY credit_ledger_read ON "credit_ledger" FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS credit_ledger_spend ON "credit_ledger";
--> statement-breakpoint
CREATE POLICY credit_ledger_spend ON "credit_ledger" FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid AND amount < 0 AND reason = 'plan_purchase');
--> statement-breakpoint
-- The company in the current transaction (app.current_tenant_id) was invited
-- with p_code: record the referral for the inviter and credit the welcome
-- bonus. Returns no row when it does not qualify: unknown or own code, a
-- suspended inviter, a company older than 30 days, one already referred, or
-- an inviter and invitee sharing a member (self-referral).
DROP FUNCTION IF EXISTS claim_referral(text, integer, integer);
--> statement-breakpoint
CREATE FUNCTION claim_referral(p_code text, p_welcome_friend integer, p_welcome_accountant integer)
RETURNS TABLE (program varchar, credits integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referred uuid := nullif(current_setting('app.current_tenant_id', true), '')::uuid;
  v_referrer uuid;
  v_program varchar;
  v_credits integer;
  v_referral uuid;
BEGIN
  IF v_referred IS NULL OR p_code IS NULL THEN RETURN; END IF;
  SELECT t.id, t.referral_program INTO v_referrer, v_program
    FROM tenants t
    WHERE t.referral_code = upper(p_code) AND t.suspended_at IS NULL;
  IF v_referrer IS NULL OR v_referrer = v_referred THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = v_referred AND created_at > now() - interval '30 days') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_tenant_id = v_referred) THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM tenant_memberships a JOIN tenant_memberships b ON a.user_id = b.user_id
    WHERE a.tenant_id = v_referrer AND b.tenant_id = v_referred
  ) THEN RETURN; END IF;

  v_credits := least(greatest(CASE WHEN v_program = 'accountant' THEN p_welcome_accountant ELSE p_welcome_friend END, 0), 2000);
  INSERT INTO referrals (tenant_id, referred_tenant_id, program)
    VALUES (v_referrer, v_referred, v_program)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_referral;
  IF v_referral IS NULL THEN RETURN; END IF;
  IF v_credits > 0 THEN
    INSERT INTO credit_ledger (tenant_id, amount, reason, referral_id)
      VALUES (v_referred, v_credits, 'referral_welcome', v_referral);
  END IF;
  program := v_program;
  credits := v_credits;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint
-- p_referred just started paying: credit its inviter once. Returns the
-- credits granted (0 when there is no unpaid referral).
DROP FUNCTION IF EXISTS reward_referral(uuid, integer, integer);
--> statement-breakpoint
CREATE FUNCTION reward_referral(p_referred uuid, p_reward_friend integer, p_reward_accountant integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r referrals%ROWTYPE;
  v_credits integer;
BEGIN
  SELECT * INTO r FROM referrals WHERE referred_tenant_id = p_referred AND rewarded_at IS NULL FOR UPDATE;
  IF r.id IS NULL THEN RETURN 0; END IF;
  v_credits := least(greatest(CASE WHEN r.program = 'accountant' THEN p_reward_accountant ELSE p_reward_friend END, 0), 5000);
  UPDATE referrals SET rewarded_at = now(), reward_credits = v_credits WHERE id = r.id;
  IF v_credits > 0 THEN
    INSERT INTO credit_ledger (tenant_id, amount, reason, referral_id)
      VALUES (r.tenant_id, v_credits, 'referral_reward', r.id)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_credits;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_referral(text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION reward_referral(uuid, integer, integer) FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" varchar(60) NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "description" text,
  "logo_url" text,
  "category" varchar(16) NOT NULL DEFAULT 'other' CHECK ("category" IN ('accounting', 'banking', 'software', 'service', 'other')),
  "featured" boolean NOT NULL DEFAULT false,
  "show_in_footer" boolean NOT NULL DEFAULT false,
  "weight" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "clicks" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partners_slug_unique" ON "partners" ("slug");
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT ON "referrals" TO faktur_app;
    GRANT SELECT, INSERT ON "credit_ledger" TO faktur_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "partners" TO faktur_app;
    GRANT EXECUTE ON FUNCTION claim_referral(text, integer, integer) TO faktur_app;
    GRANT EXECUTE ON FUNCTION reward_referral(uuid, integer, integer) TO faktur_app;
  END IF;
END $$;
