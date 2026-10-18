-- A custom name per link: /i/web-redesign-k3Fq9Xa2Lm7P for one invoice,
-- /c/acme-projekty-<key> for one customer's portal, set next to the copy
-- button instead of the prefix from Settings → Faktury.
--
-- The name stays cosmetic, exactly like the prefix it replaces: only the key
-- after the last dash is looked up (0057), so these columns are not unique,
-- are never part of a lookup, and a name can repeat across invoices without
-- making any link guessable. NULL means "use the company setting".
--
-- The CHECK is the format customSlugOf() in public-links/public-link.ts
-- produces (lower-case a-z, 0-9, single dashes, at most 40), so a row
-- written past the API still cannot break the link format.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "public_slug" text;
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_public_slug_format";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_public_slug_format"
  CHECK ("public_slug" IS NULL OR ("public_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("public_slug") <= 40));
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "portal_slug" text;
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_portal_slug_format";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_portal_slug_format"
  CHECK ("portal_slug" IS NULL OR ("portal_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("portal_slug") <= 40));
--> statement-breakpoint
-- The portal builds each document's link, so it needs the invoice's name too.
-- The return type changes, hence drop and create. Mirrored in rls-policies.sql.
DROP FUNCTION IF EXISTS get_client_portal_documents(uuid);
--> statement-breakpoint
CREATE FUNCTION get_client_portal_documents(p_portal_token uuid)
RETURNS TABLE (
  public_token uuid,
  public_key text,
  public_slug text,
  invoice_number varchar(32),
  document_type text,
  status text,
  issue_date timestamptz,
  due_date timestamptz,
  currency varchar(3),
  amount_paid numeric,
  reverse_charge boolean,
  client_response varchar(16),
  line_items jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.public_token,
    i.public_key,
    i.public_slug,
    i.invoice_number,
    i.document_type::text,
    i.status::text,
    i.issue_date,
    i.due_date,
    i.currency,
    i.amount_paid,
    i.reverse_charge,
    i.client_response,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object('quantity', li.quantity, 'unitPrice', li.unit_price, 'vatRate', li.vat_rate, 'discountPercent', li.discount_percent))
      FROM invoice_line_items li WHERE li.invoice_id = i.id
    ), '[]'::jsonb)
  FROM contacts c
  JOIN tenants t ON t.id = c.tenant_id AND t.suspended_at IS NULL
  JOIN invoices i ON i.contact_id = c.id AND i.tenant_id = c.tenant_id
  WHERE c.portal_token = p_portal_token
    AND i.status NOT IN ('draft', 'pending_review')
  ORDER BY i.issue_date DESC NULLS LAST, i.created_at DESC
  LIMIT 500;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_client_portal_documents(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION get_client_portal_documents(uuid) TO faktur_app;
  END IF;
END $$;
