-- "Důvěrný režim" (docs/research/client-side-encryption.md, phase 1): the
-- browser encrypts item descriptions and invoice notes with a per-company data
-- key, so the server and its backups hold only ciphertext (`enc:v1:…` in the
-- existing text columns, next to plain rows).
--   * tenant_vaults: one row per company that switched the mode on. key_check
--     is a known text sealed with the data key, so a browser can tell that an
--     unwrapped key is the company's. seal_new: the editor encrypts new
--     documents by default.
--     categories: what the company chose to encrypt. Only "texts" (item
--     descriptions and notes) exists in this slice; the others are planned.
--   * vault_key_wraps: the data key wrapped by a member's vault password or
--     passkey (WebAuthn PRF), or by the company's recovery code (user_id null).
--     The server never sees the key, the password, the PRF output or the code.
-- Both are tenant tables with the standard tenant_isolation policy.
CREATE TABLE IF NOT EXISTS "tenant_vaults" (
  "tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "key_check" text NOT NULL,
  "seal_new" boolean DEFAULT true NOT NULL,
  "categories" text[] DEFAULT ARRAY['texts']::text[] NOT NULL,
  "enabled_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vault_key_wraps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant_vaults"("tenant_id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE cascade,
  "kind" varchar(16) NOT NULL,
  "kdf" varchar(16) NOT NULL,
  "iterations" integer,
  "salt" text NOT NULL,
  "iv" text NOT NULL,
  "wrapped_key" text NOT NULL,
  "credential_id" text,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault_key_wraps" DROP CONSTRAINT IF EXISTS "vault_key_wraps_kind_check";
--> statement-breakpoint
ALTER TABLE "vault_key_wraps" ADD CONSTRAINT "vault_key_wraps_kind_check" CHECK (
  ("kind" = 'recovery' AND "user_id" IS NULL AND "kdf" = 'hkdf-sha256')
  OR ("kind" = 'password' AND "user_id" IS NOT NULL AND "kdf" = 'pbkdf2-sha256' AND "iterations" >= 100000)
  OR ("kind" = 'passkey' AND "user_id" IS NOT NULL AND "kdf" = 'hkdf-sha256' AND "credential_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vault_key_wraps_recovery_unique" ON "vault_key_wraps" ("tenant_id") WHERE "kind" = 'recovery';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vault_key_wraps_password_unique" ON "vault_key_wraps" ("tenant_id", "user_id") WHERE "kind" = 'password';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vault_key_wraps_tenant_user_idx" ON "vault_key_wraps" ("tenant_id", "user_id");
--> statement-breakpoint
ALTER TABLE "tenant_vaults" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_vaults" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenant_vaults";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_vaults"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "vault_key_wraps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault_key_wraps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "vault_key_wraps";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "vault_key_wraps"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
-- Migrations run as the table owner; grant here too when the app role
-- already exists (app-role-grants.sql covers it again after every migrate).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_vaults", "vault_key_wraps" TO faktur_app;
  END IF;
END
$$;
