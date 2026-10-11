-- Abuse protection: account suspension, paused e-mail sending, a per-tenant
-- log of outgoing customer e-mails (daily caps) and public abuse reports.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "suspension_reason" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "email_paused_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "recipient" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_emails_tenant_created_idx" ON "outbound_emails" ("tenant_id", "created_at");
--> statement-breakpoint
ALTER TABLE "outbound_emails" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbound_emails" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "outbound_emails";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "outbound_emails"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
-- Reports come from recipients without any session; the app role can't read
-- or write the table directly (RLS on, no policy), only through
-- report_invoice_abuse(). The operator reviews them as the owner role.
CREATE TABLE IF NOT EXISTS "abuse_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "message" text,
  "reporter_email" text,
  "reporter_bucket" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  CONSTRAINT "abuse_reports_reason_check" CHECK ("reason" IN ('fraud', 'not_ordered', 'spam', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abuse_reports_invoice_bucket_uniq" ON "abuse_reports" ("invoice_id", "reporter_bucket");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abuse_reports_tenant_created_idx" ON "abuse_reports" ("tenant_id", "created_at");
--> statement-breakpoint
ALTER TABLE "abuse_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "abuse_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP FUNCTION IF EXISTS report_invoice_abuse(uuid, text, text, text, text, integer);
--> statement-breakpoint
CREATE FUNCTION report_invoice_abuse(
  p_public_token uuid,
  p_reason text,
  p_message text,
  p_reporter_email text,
  p_reporter_bucket text,
  p_pause_threshold integer
)
RETURNS TABLE (tenant_id uuid, invoice_id uuid, invoice_number varchar(32), company_name text, reporters integer, paused boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_invoice invoices%ROWTYPE;
  v_reporters integer;
  v_paused boolean := false;
BEGIN
  SELECT * INTO v_invoice FROM invoices i
  WHERE i.public_token = p_public_token AND i.status NOT IN ('draft', 'pending_review')
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO abuse_reports (tenant_id, invoice_id, reason, message, reporter_email, reporter_bucket)
  VALUES (v_invoice.tenant_id, v_invoice.id, p_reason, left(p_message, 2000), left(p_reporter_email, 200), p_reporter_bucket)
  ON CONFLICT ("invoice_id", "reporter_bucket") DO NOTHING;

  -- Distinct reporters across the company's documents in the last 7 days.
  SELECT count(DISTINCT r.reporter_bucket)::integer INTO v_reporters
  FROM abuse_reports r
  WHERE r.tenant_id = v_invoice.tenant_id AND r.created_at > now() - interval '7 days' AND r.resolved_at IS NULL;

  IF v_reporters >= p_pause_threshold THEN
    UPDATE tenants t SET email_paused_at = coalesce(t.email_paused_at, now())
    WHERE t.id = v_invoice.tenant_id;
    v_paused := true;
  END IF;

  RETURN QUERY
    SELECT v_invoice.tenant_id, v_invoice.id, v_invoice.invoice_number, t.company_name, v_reporters, v_paused
    FROM tenants t WHERE t.id = v_invoice.tenant_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION report_invoice_abuse(uuid, text, text, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
DROP FUNCTION IF EXISTS public_invoice_blocked(uuid);
--> statement-breakpoint
-- Whether the company behind a share link is suspended (portal shows a notice instead of the document).
CREATE FUNCTION public_invoice_blocked(p_public_token uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM invoices i JOIN tenants t ON t.id = i.tenant_id
    WHERE i.public_token = p_public_token AND t.suspended_at IS NOT NULL
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_invoice_blocked(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT ON "outbound_emails" TO faktur_app;
    GRANT EXECUTE ON FUNCTION report_invoice_abuse(uuid, text, text, text, text, integer) TO faktur_app;
    GRANT EXECUTE ON FUNCTION public_invoice_blocked(uuid) TO faktur_app;
  END IF;
END $$;
