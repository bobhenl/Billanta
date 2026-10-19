-- Referral rewards that survive abuse, an accountant partner tier staff
-- approve, and two signup flags on the user.
--
--   * referrals: the inviter's reward is no longer a fixed sum paid on the
--     first "active" status. It is the invited company's first payment in
--     CZK, capped per programme (rewards.ts), and it is held back until the
--     company is past the refund window: the second payment of a monthly
--     plan, or 30 days after the first payment of an annual (prepaid) one.
--     A refund or a cancellation before that voids it. pending_credits holds
--     the amount between the first payment and the release.
--   * reward_referral() is dropped: it paid at once, which is exactly what a
--     pay-and-refund sign-up exploited. record_referral_payment(),
--     void_referral_reward() and release_due_referral_rewards() replace it.
--   * accountant_partner_requests: the partner tier is no longer a switch
--     anyone can flip. A company asks for it, a platform admin approves it
--     in the accountant directory queue (approving the listing can approve
--     both). RLS lets the company store only 'pending'. claim_referral()
--     keeps the accountant programme only for an approved partner, so a
--     direct write to tenants.referral_program changes nothing. The amounts
--     come from the caller (REFERRAL_REWARDS) and are the same for both
--     programmes today: the tier marks a vetted accountant, not a payout.
--   * The directory no longer requires the partner tier (it is now the way
--     in), so public_accountant_listings() drops that filter.
--   * users.manages_clients / users.is_teacher: optional signup checkboxes.
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "first_paid_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "paid_count" smallint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "pending_credits" integer;
--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "release_after" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "void_reason" varchar(16);
--> statement-breakpoint
ALTER TABLE "referrals" DROP CONSTRAINT IF EXISTS "referrals_void_reason_check";
--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_void_reason_check" CHECK ("void_reason" IS NULL OR "void_reason" IN ('refunded', 'canceled'));
--> statement-breakpoint
-- The daily release scans only what is waiting.
CREATE INDEX IF NOT EXISTS "referrals_release_due_idx" ON "referrals" ("release_after")
  WHERE "rewarded_at" IS NULL AND "voided_at" IS NULL AND "release_after" IS NOT NULL;
--> statement-breakpoint
DROP FUNCTION IF EXISTS reward_referral(uuid, integer, integer);
--> statement-breakpoint
-- Pays one held-back reward. Internal: called by the two functions below,
-- never granted to the app.
DROP FUNCTION IF EXISTS release_referral_reward(uuid);
--> statement-breakpoint
CREATE FUNCTION release_referral_reward(p_referral uuid)
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
  SELECT * INTO r FROM referrals WHERE id = p_referral AND rewarded_at IS NULL AND voided_at IS NULL FOR UPDATE;
  IF r.id IS NULL OR r.first_paid_at IS NULL THEN RETURN 0; END IF;
  v_credits := least(greatest(coalesce(r.pending_credits, 0), 0), 5000);
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
-- p_referred has made a real payment (Stripe invoice, GoPay, a paid
-- proforma; never credits). The first payment fixes the reward: the
-- caller passes it already capped for each programme, and the referral's
-- own programme picks one. A monthly plan releases it on the second
-- payment; an annual one passes p_release_after (first payment + 30 days)
-- and waits for release_due_referral_rewards(). Returns the credits paid
-- out now (0 while the reward is held back or there is none).
DROP FUNCTION IF EXISTS record_referral_payment(uuid, integer, integer, timestamp with time zone);
--> statement-breakpoint
CREATE FUNCTION record_referral_payment(p_referred uuid, p_credits_friend integer, p_credits_accountant integer, p_release_after timestamp with time zone)
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
  SELECT * INTO r FROM referrals WHERE referred_tenant_id = p_referred AND rewarded_at IS NULL AND voided_at IS NULL FOR UPDATE;
  IF r.id IS NULL THEN RETURN 0; END IF;
  IF r.first_paid_at IS NULL THEN
    v_credits := least(greatest(coalesce(CASE WHEN r.program = 'accountant' THEN p_credits_accountant ELSE p_credits_friend END, 0), 0), 5000);
    IF v_credits <= 0 THEN RETURN 0; END IF;
    UPDATE referrals
      SET first_paid_at = now(), paid_count = 1, pending_credits = v_credits, release_after = p_release_after
      WHERE id = r.id;
    RETURN 0;
  END IF;
  UPDATE referrals SET paid_count = paid_count + 1 WHERE id = r.id;
  -- A second real payment means the first one was not a pay-and-refund. A
  -- prepaid year keeps its own 30-day hold even if another payment comes in.
  IF r.paid_count + 1 >= 2 AND (r.release_after IS NULL OR r.release_after <= now()) THEN
    RETURN release_referral_reward(r.id);
  END IF;
  RETURN 0;
END;
$$;
--> statement-breakpoint
-- The referred company was refunded or cancelled while its inviter's reward
-- was still held back: nothing is paid for it, ever. A company that has not
-- paid yet has nothing held back, so a cancelled trial changes nothing.
DROP FUNCTION IF EXISTS void_referral_reward(uuid, text);
--> statement-breakpoint
CREATE FUNCTION void_referral_reward(p_referred uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_reason NOT IN ('refunded', 'canceled') THEN RETURN false; END IF;
  UPDATE referrals
    SET voided_at = now(), void_reason = p_reason, pending_credits = NULL
    WHERE referred_tenant_id = p_referred AND rewarded_at IS NULL AND voided_at IS NULL AND first_paid_at IS NOT NULL;
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
-- Daily (ReferralRewardsCron): pays every annual-plan reward whose 30 days
-- have passed without a refund. Returns how many were paid.
DROP FUNCTION IF EXISTS release_due_referral_rewards();
--> statement-breakpoint
CREATE FUNCTION release_due_referral_rewards()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM referrals
    WHERE rewarded_at IS NULL AND voided_at IS NULL AND first_paid_at IS NOT NULL AND release_after <= now()
    ORDER BY release_after
    LIMIT 1000
  LOOP
    IF release_referral_reward(v_id) > 0 THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accountant_partner_requests" (
  "tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "status" varchar(12) NOT NULL DEFAULT 'pending',
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reviewed_at" timestamp with time zone,
  "review_note" text
);
--> statement-breakpoint
ALTER TABLE "accountant_partner_requests" DROP CONSTRAINT IF EXISTS "accountant_partner_requests_status_check";
--> statement-breakpoint
ALTER TABLE "accountant_partner_requests" ADD CONSTRAINT "accountant_partner_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'));
--> statement-breakpoint
ALTER TABLE "accountant_partner_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accountant_partner_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS accountant_partner_requests_read ON "accountant_partner_requests";
--> statement-breakpoint
CREATE POLICY accountant_partner_requests_read ON "accountant_partner_requests" FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
-- A company can only ask (again): approving goes through the admin functions below.
DROP POLICY IF EXISTS accountant_partner_requests_insert ON "accountant_partner_requests";
--> statement-breakpoint
CREATE POLICY accountant_partner_requests_insert ON "accountant_partner_requests" FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid AND status = 'pending');
--> statement-breakpoint
DROP POLICY IF EXISTS accountant_partner_requests_update ON "accountant_partner_requests";
--> statement-breakpoint
CREATE POLICY accountant_partner_requests_update ON "accountant_partner_requests" FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid AND status = 'pending');
--> statement-breakpoint
-- Companies already on the partner tier: those with an approved listing were
-- vetted and stay partners; the rest go back to the friend tier and wait in
-- the queue with a request, so staff see who was using it.
INSERT INTO "accountant_partner_requests" ("tenant_id", "status", "requested_at", "reviewed_at")
SELECT t.id,
       CASE WHEN l.status = 'approved' THEN 'approved' ELSE 'pending' END,
       now(),
       CASE WHEN l.status = 'approved' THEN now() END
FROM tenants t
LEFT JOIN accountant_listings l ON l.tenant_id = t.id
WHERE t.referral_program = 'accountant'
ON CONFLICT ("tenant_id") DO NOTHING;
--> statement-breakpoint
UPDATE "tenants" SET "referral_program" = 'friend'
WHERE "referral_program" = 'accountant'
  AND NOT EXISTS (SELECT 1 FROM accountant_partner_requests p WHERE p.tenant_id = tenants.id AND p.status = 'approved');
--> statement-breakpoint
-- Same as 0044, except that the accountant programme needs an approved
-- partner. The welcome amounts are parameters, so equal tiers need no SQL change.
CREATE OR REPLACE FUNCTION claim_referral(p_code text, p_welcome_friend integer, p_welcome_accountant integer)
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
  IF v_program = 'accountant' AND NOT EXISTS (
    SELECT 1 FROM accountant_partner_requests p WHERE p.tenant_id = v_referrer AND p.status = 'approved'
  ) THEN
    v_program := 'friend';
  END IF;
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
CREATE OR REPLACE FUNCTION public_accountant_listings()
RETURNS TABLE (
  id uuid,
  display_name text,
  bio text,
  regions varchar[],
  remote boolean,
  services varchar[],
  languages varchar[],
  price_hint text,
  contact_email text,
  website text,
  profile_slug text,
  approved_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.display_name, l.bio, l.regions, l.remote, l.services, l.languages, l.price_hint,
         l.contact_email, l.website,
         CASE WHEN (t.public_profile->>'enabled')::boolean IS TRUE THEN lower(t.public_profile->>'slug') END,
         l.reviewed_at
  FROM accountant_listings l
  JOIN tenants t ON t.id = l.tenant_id
  WHERE l.status = 'approved'
    AND t.suspended_at IS NULL
  ORDER BY l.reviewed_at DESC NULLS LAST
  LIMIT 500;
$$;
--> statement-breakpoint
-- Adds the partner request to each row. The pending tab also shows approved
-- listings whose company is waiting for the partner tier.
DROP FUNCTION IF EXISTS admin_accountant_listings(text);
--> statement-breakpoint
CREATE FUNCTION admin_accountant_listings(p_status text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  company_name text,
  ico varchar,
  display_name text,
  bio text,
  regions varchar[],
  remote boolean,
  services varchar[],
  languages varchar[],
  price_hint text,
  contact_email text,
  website text,
  status varchar,
  review_note text,
  reviewed_at timestamp with time zone,
  updated_at timestamp with time zone,
  partner_status varchar,
  partner_requested_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.tenant_id, t.company_name, t.ico, l.display_name, l.bio, l.regions, l.remote, l.services,
         l.languages, l.price_hint, l.contact_email, l.website, l.status, l.review_note, l.reviewed_at, l.updated_at,
         p.status, p.requested_at
  FROM accountant_listings l
  JOIN tenants t ON t.id = l.tenant_id
  LEFT JOIN accountant_partner_requests p ON p.tenant_id = l.tenant_id
  WHERE p_status IS NULL OR l.status = p_status OR (p_status = 'pending' AND p.status = 'pending')
  ORDER BY l.updated_at DESC
  LIMIT 500;
$$;
--> statement-breakpoint
-- Approve or reject one listing, as in 0050. With p_partner, approving it
-- also approves the company's pending partner request and switches the
-- company to the partner tier; rejecting it rejects the request too (the
-- tier needs an approved listing).
DROP FUNCTION IF EXISTS review_accountant_listing(uuid, text, text, timestamp with time zone);
--> statement-breakpoint
DROP FUNCTION IF EXISTS review_accountant_listing(uuid, text, text, timestamp with time zone, boolean);
--> statement-breakpoint
CREATE FUNCTION review_accountant_listing(p_id uuid, p_status text, p_note text, p_updated_at timestamp with time zone, p_partner boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN RETURN false; END IF;
  UPDATE accountant_listings
    SET status = p_status, review_note = left(p_note, 500), reviewed_at = now()
    WHERE id = p_id AND status <> 'withdrawn' AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', p_updated_at)
    RETURNING tenant_id INTO v_tenant;
  IF v_tenant IS NULL THEN RETURN false; END IF;
  IF p_partner THEN
    UPDATE accountant_partner_requests
      SET status = p_status, reviewed_at = now(), review_note = left(p_note, 500)
      WHERE tenant_id = v_tenant AND status = 'pending';
    IF FOUND AND p_status = 'approved' THEN
      UPDATE tenants SET referral_program = 'accountant', updated_at = now() WHERE id = v_tenant;
    END IF;
  END IF;
  RETURN true;
END;
$$;
--> statement-breakpoint
-- Decide only the partner request (the listing was reviewed earlier).
-- Approving needs an approved listing; rejecting (or revoking an approved
-- partner) puts the company back on the friend tier.
DROP FUNCTION IF EXISTS review_accountant_partner(uuid, text, text);
--> statement-breakpoint
CREATE FUNCTION review_accountant_partner(p_tenant uuid, p_status text, p_note text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN RETURN false; END IF;
  IF p_status = 'approved' AND NOT EXISTS (
    SELECT 1 FROM accountant_listings WHERE tenant_id = p_tenant AND status = 'approved'
  ) THEN RETURN false; END IF;
  UPDATE accountant_partner_requests
    SET status = p_status, reviewed_at = now(), review_note = left(p_note, 500)
    WHERE tenant_id = p_tenant;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE tenants
    SET referral_program = CASE WHEN p_status = 'approved' THEN 'accountant' ELSE 'friend' END, updated_at = now()
    WHERE id = p_tenant;
  RETURN true;
END;
$$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "manages_clients" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_teacher" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
REVOKE ALL ON FUNCTION release_referral_reward(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION record_referral_payment(uuid, integer, integer, timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION void_referral_reward(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION release_due_referral_rewards() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_accountant_listings(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION review_accountant_listing(uuid, text, text, timestamp with time zone, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION review_accountant_partner(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "accountant_partner_requests" TO faktur_app;
    GRANT EXECUTE ON FUNCTION record_referral_payment(uuid, integer, integer, timestamp with time zone) TO faktur_app;
    GRANT EXECUTE ON FUNCTION void_referral_reward(uuid, text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION release_due_referral_rewards() TO faktur_app;
    GRANT EXECUTE ON FUNCTION admin_accountant_listings(text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION review_accountant_listing(uuid, text, text, timestamp with time zone, boolean) TO faktur_app;
    GRANT EXECUTE ON FUNCTION review_accountant_partner(uuid, text, text) TO faktur_app;
  END IF;
END $$;
