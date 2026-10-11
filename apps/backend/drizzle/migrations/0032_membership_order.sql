-- Several companies per user: the membership list (and so the default
-- active company) comes back in a stable order — oldest membership first.
CREATE OR REPLACE FUNCTION list_tenant_memberships_for_user(p_user_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  company_name text,
  role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tm.tenant_id,
    t.company_name,
    tm.role::text
  FROM tenant_memberships tm
  JOIN tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = p_user_id
  ORDER BY tm.created_at, t.company_name;
$$;
