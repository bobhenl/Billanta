-- Objednávky z veřejného profilu: a visitor orders a service from the
-- company's "Služby a ceník" and fills in their billing details; the order
-- becomes a draft (status pending_review, source profile_order) for the owner
-- to review. Nothing is issued or e-mailed to the customer. Section 4 adds
-- the "Kontaktovat" message form, and "Platba předem" needs no schema change
-- (the variable symbol goes into invoices.variable_symbol).
--
-- 1) A new invoice source, so the owner sees where the draft came from and
--    the per-company daily cap can count today's orders. Not used anywhere
--    else in this migration (a new enum value can't be used in the same
--    transaction).
ALTER TYPE "invoice_source" ADD VALUE IF NOT EXISTS 'profile_order';
--> statement-breakpoint
-- 2) Services get a stable id: the per-service order link (?service=<id>)
--    must survive reordering and renaming. Existing services get one derived
--    from the tenant and position; settings keep it from then on.
UPDATE "tenants" t
SET "public_profile" = jsonb_set(
  t."public_profile",
  '{services}',
  (
    SELECT coalesce(jsonb_agg(
      CASE
        WHEN s.value ? 'id' AND s.value->>'id' ~ '^[a-z0-9]{6,24}$' THEN s.value
        ELSE s.value || jsonb_build_object('id', substr(md5(t.id::text || ':' || s.ord::text), 1, 12))
      END
      ORDER BY s.ord
    ), '[]'::jsonb)
    FROM jsonb_array_elements(t."public_profile"->'services') WITH ORDINALITY AS s(value, ord)
  )
)
WHERE jsonb_typeof(t."public_profile"->'services') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t."public_profile"->'services') AS s(value)
    WHERE NOT (s.value ? 'id') OR NOT (s.value->>'id' ~ '^[a-z0-9]{6,24}$')
  );
--> statement-breakpoint
-- 3) Which company a profile order belongs to. Same hardening as
--    get_buyer_details_target: one static SELECT on the slug, only for a
--    published profile with "Přijímat objednávky z profilu" switched on, and
--    nothing for suspended companies. Returns only the id; the order itself
--    is written in an ordinary tenant-scoped transaction under RLS.
DROP FUNCTION IF EXISTS get_profile_order_target(text);
--> statement-breakpoint
CREATE FUNCTION get_profile_order_target(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
  FROM tenants t
  WHERE lower(t.public_profile->>'slug') = lower(p_slug)
    AND (t.public_profile->>'enabled')::boolean IS TRUE
    AND (t.public_profile->'orders'->>'enabled')::boolean IS TRUE
    AND t.suspended_at IS NULL
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_profile_order_target(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION get_profile_order_target(text) TO faktur_app;
  END IF;
END $$;
--> statement-breakpoint
-- 4) "Kontaktovat" on the profile: a visitor's message becomes an in-app
--    notification for the company's members. Same shape as above, gated on
--    the profile's own "contactForm" switch instead of orders.
DROP FUNCTION IF EXISTS get_profile_message_target(text);
--> statement-breakpoint
CREATE FUNCTION get_profile_message_target(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
  FROM tenants t
  WHERE lower(t.public_profile->>'slug') = lower(p_slug)
    AND (t.public_profile->>'enabled')::boolean IS TRUE
    AND (t.public_profile->>'contactForm')::boolean IS TRUE
    AND t.suspended_at IS NULL
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_profile_message_target(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION get_profile_message_target(text) TO faktur_app;
  END IF;
END $$;
