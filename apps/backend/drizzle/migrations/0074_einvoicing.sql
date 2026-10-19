-- Slovak e-invoicing over Peppol (docs/sk-einvoicing-2027.md, gap plan 3–5).
--
-- Billanta does not run its own access point; a certified provider does
-- (docs/sk-peppol-providers.md). These tables record what went through it:
--   * einvoice_participants: a company's registration as a Peppol
--     participant (0245:<DIČ> for SK) at a provider. One active per company
--     and provider. The same participant ID can never be active for two
--     companies, because incoming documents are routed to a company by it.
--   * outgoing_einvoices: every e-invoice we handed to the provider, with
--     the exact XML that went out (§ 85o ods. 15: 10-year archive, so we
--     keep what was sent, never a regenerated copy) and its delivery and
--     reporting status.
--   * incoming_einvoices: documents received for the company. Each one
--     waits as pending_review with a parsed expense draft; an expense is
--     created only when a person accepts it. Nothing is booked
--     automatically.
--   * einvoice_status_events: append-only log of every status the provider
--     reported, for support and audits.
--
-- All four are tenant tables with the standard tenant_isolation policy.
-- Provider webhooks arrive before the tenant is known; the two SECURITY
-- DEFINER functions at the end only resolve the tenant (by participant ID
-- or by provider message ID). The rows themselves are then written in a
-- normal RLS-scoped transaction for that tenant.
--
-- The whole feature is off unless EINVOICING_ENABLED=true.
CREATE TABLE IF NOT EXISTS "einvoice_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "provider" varchar(32) NOT NULL,
  "participant_id" varchar(64) NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "provider_ref" varchar(128),
  "last_error" text,
  "registered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "einvoice_participants_status_check" CHECK ("status" IN ('pending', 'registered', 'failed', 'deregistered'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "einvoice_participants_tenant_provider_unique" ON "einvoice_participants" ("tenant_id", "provider") WHERE "status" <> 'deregistered';
--> statement-breakpoint
-- Global on purpose (RLS does not hide rows from a unique index): a second
-- company claiming the same DIČ must fail, or it would get the first one's mail.
CREATE UNIQUE INDEX IF NOT EXISTS "einvoice_participants_participant_unique" ON "einvoice_participants" ("provider", "participant_id") WHERE "status" <> 'deregistered';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outgoing_einvoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE restrict,
  "provider" varchar(32) NOT NULL,
  "sender_participant_id" varchar(64) NOT NULL,
  "receiver_participant_id" varchar(64) NOT NULL,
  "document_type" varchar(16) NOT NULL,
  "xml" text NOT NULL,
  "xml_sha256" char(64) NOT NULL,
  "provider_message_id" varchar(128),
  "status" varchar(16) DEFAULT 'queued' NOT NULL,
  "status_reason" text,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "reported_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outgoing_einvoices_status_check" CHECK ("status" IN ('queued', 'sent', 'delivered', 'reported', 'rejected', 'failed')),
  CONSTRAINT "outgoing_einvoices_document_type_check" CHECK ("document_type" IN ('invoice', 'credit_note'))
);
--> statement-breakpoint
-- At most one live transmission per invoice: a double click must not send
-- the same tax document twice. A rejected or failed one may be retried.
CREATE UNIQUE INDEX IF NOT EXISTS "outgoing_einvoices_invoice_live_unique" ON "outgoing_einvoices" ("tenant_id", "invoice_id") WHERE "status" NOT IN ('rejected', 'failed');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outgoing_einvoices_message_unique" ON "outgoing_einvoices" ("provider", "provider_message_id") WHERE "provider_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outgoing_einvoices_invoice_idx" ON "outgoing_einvoices" ("invoice_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incoming_einvoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "provider" varchar(32) NOT NULL,
  "provider_message_id" varchar(128) NOT NULL,
  "sender_participant_id" varchar(64) NOT NULL,
  "receiver_participant_id" varchar(64) NOT NULL,
  "document_type" varchar(16) NOT NULL,
  "document_number" varchar(128),
  "issue_date" date,
  "supplier_name" text,
  "currency" varchar(3),
  "total" numeric(14, 2),
  "xml" text NOT NULL,
  "xml_sha256" char(64) NOT NULL,
  "draft" jsonb NOT NULL,
  "review_status" varchar(16) DEFAULT 'pending_review' NOT NULL,
  "expense_id" uuid REFERENCES "expenses"("id") ON DELETE set null,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "incoming_einvoices_review_status_check" CHECK ("review_status" IN ('pending_review', 'accepted', 'rejected')),
  CONSTRAINT "incoming_einvoices_document_type_check" CHECK ("document_type" IN ('invoice', 'credit_note'))
);
--> statement-breakpoint
-- Providers redeliver webhooks; the message ID makes a redelivery a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS "incoming_einvoices_message_unique" ON "incoming_einvoices" ("provider", "provider_message_id");
--> statement-breakpoint
-- The same document sent twice (e.g. through two providers) is one expense.
CREATE UNIQUE INDEX IF NOT EXISTS "incoming_einvoices_document_unique" ON "incoming_einvoices" ("tenant_id", "sender_participant_id", "document_type", "document_number") WHERE "document_number" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_einvoices_review_idx" ON "incoming_einvoices" ("tenant_id", "review_status", "received_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "einvoice_status_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict,
  "outgoing_einvoice_id" uuid NOT NULL REFERENCES "outgoing_einvoices"("id") ON DELETE restrict,
  "status" varchar(16) NOT NULL,
  "reason" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "einvoice_status_events_outgoing_idx" ON "einvoice_status_events" ("outgoing_einvoice_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "einvoice_participants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "einvoice_participants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "einvoice_participants";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "einvoice_participants"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "outgoing_einvoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outgoing_einvoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "outgoing_einvoices";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "outgoing_einvoices"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "incoming_einvoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "incoming_einvoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "incoming_einvoices";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "incoming_einvoices"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "einvoice_status_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "einvoice_status_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "einvoice_status_events";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "einvoice_status_events"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
-- Incoming webhook: which company owns this receiving participant? Only a
-- registered participant counts, so a pending or removed registration
-- receives nothing.
CREATE OR REPLACE FUNCTION einvoice_tenant_for_participant(p_provider text, p_participant_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM einvoice_participants
  WHERE provider = p_provider AND participant_id = p_participant_id AND status = 'registered'
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION einvoice_tenant_for_participant(text, text) FROM PUBLIC;
--> statement-breakpoint
-- Status webhook: which company sent this message?
CREATE OR REPLACE FUNCTION einvoice_tenant_for_message(p_provider text, p_message_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM outgoing_einvoices
  WHERE provider = p_provider AND provider_message_id = p_message_id
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION einvoice_tenant_for_message(text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "einvoice_participants", "outgoing_einvoices", "incoming_einvoices" TO faktur_app;
    GRANT SELECT, INSERT ON "einvoice_status_events" TO faktur_app;
    GRANT EXECUTE ON FUNCTION einvoice_tenant_for_participant(text, text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION einvoice_tenant_for_message(text, text) TO faktur_app;
  END IF;
END $$;
