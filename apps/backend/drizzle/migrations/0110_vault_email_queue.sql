-- "Důvěrný režim": e-mails of an encrypted document that should carry its PDF.
-- The server cannot render that PDF, so such an e-mail waits in
-- vault_email_queue until a member's browser (vault unlocked) renders the PDF
-- and sends it through the server once. A row holds no document text.
--   * tenant_vaults.email_mode: link_now (default: the e-mail goes out now
--     with the link, the PDF follows from a browser), wait (the whole e-mail
--     waits for a browser), link_only (link e-mail, no PDF follow-up).
--   * tenant_vaults.auto_send_pdf: an unlocked browser sends the queue
--     without a click. Off by default.
ALTER TABLE "tenant_vaults" ADD COLUMN IF NOT EXISTS "email_mode" varchar(16) DEFAULT 'link_now' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_vaults" ADD COLUMN IF NOT EXISTS "auto_send_pdf" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_vaults" DROP CONSTRAINT IF EXISTS "tenant_vaults_email_mode_check";
--> statement-breakpoint
ALTER TABLE "tenant_vaults" ADD CONSTRAINT "tenant_vaults_email_mode_check" CHECK ("email_mode" IN ('link_now', 'wait', 'link_only'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vault_email_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE cascade,
  "kind" varchar(16) NOT NULL,
  "recipient" text NOT NULL,
  "corrected" boolean DEFAULT false NOT NULL,
  "status" varchar(12) DEFAULT 'waiting' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "done_at" timestamp with time zone,
  "done_by" uuid REFERENCES "users"("id") ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE "vault_email_queue" DROP CONSTRAINT IF EXISTS "vault_email_queue_kind_check";
--> statement-breakpoint
ALTER TABLE "vault_email_queue" ADD CONSTRAINT "vault_email_queue_kind_check" CHECK ("kind" IN ('invoice', 'invoice_pdf') AND "status" IN ('waiting', 'sent', 'dismissed'));
--> statement-breakpoint
-- One waiting e-mail per document: sending it again while one waits does not stack a second.
CREATE UNIQUE INDEX IF NOT EXISTS "vault_email_queue_waiting_once" ON "vault_email_queue" ("tenant_id", "invoice_id") WHERE "status" = 'waiting';
--> statement-breakpoint
ALTER TABLE "vault_email_queue" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault_email_queue" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "vault_email_queue";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "vault_email_queue"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "vault_email_queue" TO faktur_app;
  END IF;
END $$;
