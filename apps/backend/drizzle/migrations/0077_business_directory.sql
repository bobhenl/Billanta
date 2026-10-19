-- Business directory (/directory, and the "who invoices with Billanta here"
-- section of the town pages): companies with a published public profile can
-- also list it, by trade and by town. Strictly opt-in: the owner switches on
-- tenants.public_profile->'directory'->'enabled' (default off) and picks a
-- trade and the town of their address. No new table; the flag lives in the
-- profile jsonb next to the other publishing choices.
--
-- public_directory_profiles() is the only anonymous read. It returns listed
-- profiles of non-suspended, non-demo companies, and only directory columns:
-- name, tagline, trade, town, logo flag, and the city only when the owner
-- shows the address on the profile anyway. Never IČO, e-mail or phone.
DROP FUNCTION IF EXISTS public_directory_profiles();
--> statement-breakpoint
CREATE FUNCTION public_directory_profiles()
RETURNS TABLE (
  slug text,
  company_name text,
  tagline text,
  trade text,
  town text,
  city text,
  country varchar(2),
  has_logo boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(t.public_profile->>'slug'),
         t.company_name,
         left(nullif(btrim(t.public_profile->>'tagline'), ''), 120),
         t.public_profile->'directory'->>'trade',
         lower(t.public_profile->'directory'->>'town'),
         CASE WHEN coalesce((t.public_profile->'show'->>'address')::boolean, true) THEN t.address_city END,
         t.address_country,
         t.logo_data IS NOT NULL AND coalesce((t.public_profile->'show'->>'logo')::boolean, true)
  FROM tenants t
  WHERE (t.public_profile->>'enabled')::boolean IS TRUE
    AND (t.public_profile->'directory'->>'enabled')::boolean IS TRUE
    AND t.public_profile->>'slug' IS NOT NULL
    AND t.public_profile->'directory'->>'trade' IS NOT NULL
    AND t.public_profile->'directory'->>'town' IS NOT NULL
    AND t.suspended_at IS NULL
    AND NOT t.is_demo
  ORDER BY t.company_name
  LIMIT 5000;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_directory_profiles() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION public_directory_profiles() TO faktur_app;
  END IF;
END $$;
