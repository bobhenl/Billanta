-- A vault passkey can also confirm a sensitive change (step-up, src/auth/step-up.ts).
--   * vault_key_wraps gets the credential's public key (SPKI DER, base64url),
--     its COSE algorithm and the last signature counter, so the server can
--     check an assertion itself. Passkeys registered before this have no key:
--     they keep unlocking the vault, and the browser asks to add them again
--     before they can confirm anything.
--   * webauthn_challenges: one random challenge per attempt, tied to the
--     member, valid for two minutes and deleted when used.
ALTER TABLE "vault_key_wraps" ADD COLUMN IF NOT EXISTS "public_key" text;
--> statement-breakpoint
ALTER TABLE "vault_key_wraps" ADD COLUMN IF NOT EXISTS "public_key_alg" integer;
--> statement-breakpoint
ALTER TABLE "vault_key_wraps" ADD COLUMN IF NOT EXISTS "sign_count" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "vault_key_wraps" DROP CONSTRAINT IF EXISTS "vault_key_wraps_public_key_check";
--> statement-breakpoint
ALTER TABLE "vault_key_wraps" ADD CONSTRAINT "vault_key_wraps_public_key_check"
  CHECK (("public_key" IS NULL) = ("public_key_alg" IS NULL) AND ("public_key" IS NULL OR "kind" = 'passkey'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
  "challenge" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webauthn_challenges_user_idx" ON "webauthn_challenges" ("user_id");
--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webauthn_challenges" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "webauthn_challenges";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webauthn_challenges"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
