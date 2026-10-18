-- Short, readable customer links: /i/2026-0012-k3Fq9Xa2Lm7P instead of
-- /i/<uuid>, and /c/novak-sro-<key> for the client portal.
--
-- Only the 12-character base62 key (~71 bits, as on /d/ since 0054) is
-- looked up; the readable part in front of it is cosmetic and rebuilt from
-- Settings → Faktury each time a link is shown. An invoice number alone is
-- guessable, so it is never the secret.
--
-- invoices.public_token and contacts.portal_token stay: links sent before
-- this migration keep working, and every get_public_* / get_client_portal*
-- function still takes the uuid. The two *_by_key functions below map a key
-- to that uuid, so none of the existing functions (and their draft and
-- suspension checks) change.
--
-- Every existing invoice and every contact with the portal on gets a key
-- here; new invoices get one from the column default, new portals from the
-- backend (ContactsService.setPortal). Mirrored in rls-policies.sql.
CREATE OR REPLACE FUNCTION gen_public_key()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  bytes bytea;
  b int;
  result text := '';
BEGIN
  -- gen_random_uuid() is the CSPRNG; bytes 6 and 8 carry the version and
  -- variant bits, and bytes >= 248 are skipped so % 62 has no bias.
  WHILE length(result) < 12 LOOP
    bytes := uuid_send(gen_random_uuid());
    FOR i IN 0..15 LOOP
      CONTINUE WHEN i IN (6, 8);
      b := get_byte(bytes, i);
      IF b < 248 AND length(result) < 12 THEN
        result := result || substr(alphabet, b % 62 + 1, 1);
      END IF;
    END LOOP;
  END LOOP;
  RETURN result;
END;
$$;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "public_key" text;
--> statement-breakpoint
UPDATE "invoices" SET "public_key" = gen_public_key() WHERE "public_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "public_key" SET DEFAULT gen_public_key();
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_public_key_unique" ON "invoices" ("public_key");
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "portal_key" text;
--> statement-breakpoint
UPDATE "contacts" SET "portal_key" = gen_public_key() WHERE "portal_token" IS NOT NULL AND "portal_key" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_portal_key_unique" ON "contacts" ("portal_key");
--> statement-breakpoint
DROP FUNCTION IF EXISTS invoice_public_token_by_key(text);
--> statement-breakpoint
CREATE FUNCTION invoice_public_token_by_key(p_key text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public_token FROM invoices WHERE public_key = p_key LIMIT 1;
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS contact_portal_token_by_key(text);
--> statement-breakpoint
CREATE FUNCTION contact_portal_token_by_key(p_key text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT portal_token FROM contacts WHERE portal_key = p_key AND portal_token IS NOT NULL LIMIT 1;
$$;
--> statement-breakpoint
-- The portal builds each document's link with the company's prefix setting.
DROP FUNCTION IF EXISTS get_client_portal(uuid);
--> statement-breakpoint
CREATE FUNCTION get_client_portal(p_portal_token uuid)
RETURNS TABLE (customer_name text, company_name text, profile_slug text, link_prefix text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.legal_name, t.company_name, t.public_profile->>'slug', t.invoice_form_prefs->>'publicLinkPrefix'
  FROM contacts c JOIN tenants t ON t.id = c.tenant_id
  WHERE c.portal_token = p_portal_token AND t.suspended_at IS NULL
  LIMIT 1;
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS get_client_portal_documents(uuid);
--> statement-breakpoint
CREATE FUNCTION get_client_portal_documents(p_portal_token uuid)
RETURNS TABLE (
  public_token uuid,
  public_key text,
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
REVOKE ALL ON FUNCTION invoice_public_token_by_key(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contact_portal_token_by_key(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_client_portal(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_client_portal_documents(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    -- gen_public_key is the column default, so inserts as faktur_app call it.
    GRANT EXECUTE ON FUNCTION gen_public_key() TO faktur_app;
    GRANT EXECUTE ON FUNCTION invoice_public_token_by_key(text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION contact_portal_token_by_key(text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION get_client_portal(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION get_client_portal_documents(uuid) TO faktur_app;
  END IF;
END $$;
