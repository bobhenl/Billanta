-- "Důvěrný režim", category "attachments": files the browser encrypted before
-- upload (@faktur/cz-compliance confidential-files.ts).
--   * enc_meta: the file's own key, name and MIME type sealed with the company
--     data key (an `enc:v1:` envelope). NULL = a plain file as before. For an
--     encrypted row `data` is ciphertext, `filename`/`mime` are placeholders
--     and the server only knows the size and the timestamps.
--   * The client portal cannot decrypt, so an encrypted invoice attachment is
--     never shown there (CHECK below, and the portal functions skip it).
--   * expense_attachments: receipts and received invoices as files. Until now
--     an expense only had a link (receipt_file_url). Same shape as
--     invoice_attachments, tenant table with the standard policy.
ALTER TABLE "invoice_attachments" ADD COLUMN IF NOT EXISTS "enc_meta" text;
--> statement-breakpoint
ALTER TABLE "invoice_attachments" DROP CONSTRAINT IF EXISTS "invoice_attachments_enc_portal_check";
--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_enc_portal_check" CHECK ("enc_meta" IS NULL OR NOT "show_in_portal");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "expense_id" uuid NOT NULL REFERENCES "expenses"("id") ON DELETE cascade,
  "filename" varchar(200) NOT NULL,
  "mime" varchar(100) NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" text NOT NULL,
  "enc_meta" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_attachments_expense_idx" ON "expense_attachments" ("expense_id");
--> statement-breakpoint
ALTER TABLE "expense_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "expense_attachments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "expense_attachments";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "expense_attachments"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "expense_attachments" TO faktur_app;
  END IF;
END $$;
