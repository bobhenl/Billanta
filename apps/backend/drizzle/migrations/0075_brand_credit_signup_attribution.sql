-- Product as a channel (docs/growth-plan.md): invoices carry a small
-- "Vystaveno v Billantě" line linking to the site with UTM tags, and signups
-- remember where they came from.
--
-- users.signup_attribution: the first-touch utm_* values, the external
-- referrer host and the landing path from the frontend's billanta_src cookie
-- (middleware.ts), saved once when the account is created. signup_source is
-- its utm_source (or the referrer host) on its own, so signups can be counted
-- per source with a plain GROUP BY. users has no RLS (Auth.js table).
--
-- get_public_invoice_brand_credit: what the public /i/ page needs to decide
-- whether to show the line (the issuer's plan and opt-out) and the issuer's
-- referral code for its link. Same hardening as public_invoice_demo.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_attribution" jsonb;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signup_source" varchar(100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_signup_source_idx" ON "users" ("signup_source") WHERE "signup_source" IS NOT NULL;
--> statement-breakpoint
DROP FUNCTION IF EXISTS get_public_invoice_brand_credit(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_public_invoice_brand_credit(p_public_token uuid)
RETURNS TABLE (
  plan_enforced boolean,
  trial_plan text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  prepaid_plan text,
  prepaid_until text,
  subscription_plan text,
  subscription_status text,
  is_demo boolean,
  brand_credit_off boolean,
  referral_code text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.plan_enforced, t.trial_plan::text, t.trial_started_at, t.trial_ends_at,
         t.prepaid_plan::text, t.prepaid_until::text, t.subscription_plan::text, t.subscription_status::text,
         t.is_demo, (t.invoice_form_prefs->>'brandCredit') = 'false', t.referral_code::text
  FROM invoices i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.public_token = p_public_token;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_public_invoice_brand_credit(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION get_public_invoice_brand_credit(uuid) TO faktur_app;
