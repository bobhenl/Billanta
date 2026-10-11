-- find_active_api_key_by_hash now also returns the key's scopes so the
-- request path can enforce read-only keys. The return type changes, so the
-- function has to be dropped first.
DROP FUNCTION IF EXISTS find_active_api_key_by_hash(text);
--> statement-breakpoint
CREATE FUNCTION find_active_api_key_by_hash(p_key_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  scopes text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, scopes
  FROM api_keys
  WHERE key_hash = p_key_hash
    AND revoked_at IS NULL
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION find_active_api_key_by_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION find_active_api_key_by_hash(text) TO faktur_app;
