-- Social sign-in no longer keeps the provider's tokens (see linkAccount in
-- apps/frontend/auth.ts); remove the ones stored before that change.
UPDATE "accounts" SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL, "session_state" = NULL
WHERE "access_token" IS NOT NULL OR "refresh_token" IS NOT NULL OR "id_token" IS NOT NULL OR "session_state" IS NOT NULL;
