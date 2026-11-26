-- Document archive on the company's own storage (src/backup-destinations/
-- document-archive.service.ts). Besides the data export, SFTP and Google
-- Drive destinations now mirror the documents themselves as readable files
-- (Billanta/<year>/vydane/<number>.pdf + .isdoc, attachments, expenses), so a
-- company keeps a full archive outside Billanta for the 10-year retention.
--
-- archive_documents: per destination switch, on by default.
-- document_archive_files: what was uploaded where and from which data
--   (fingerprint), so each run sends only new or changed documents.
-- tenants.archive_reminded_at: the quarterly "download your archive" notice
--   for companies without an automatic destination.
ALTER TABLE "backup_destinations" ADD COLUMN IF NOT EXISTS "archive_documents" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "archive_reminded_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_archive_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "destination_id" uuid NOT NULL REFERENCES "backup_destinations"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "remote_id" text,
  "size_bytes" integer NOT NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_archive_files_destination_path_unique" ON "document_archive_files" ("destination_id", "path");
--> statement-breakpoint
ALTER TABLE "document_archive_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_archive_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "document_archive_files";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_archive_files"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "document_archive_files" TO faktur_app;
  END IF;
END $$;
