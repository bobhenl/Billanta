-- Auth.js session tokens are now stored as their SHA-256 hex digest (see
-- apps/frontend/auth.ts), so a database leak no longer yields live sessions.
-- Hash the existing plaintext tokens in place so nobody is logged out.
UPDATE "sessions" SET "session_token" = encode(sha256(convert_to("session_token", 'UTF8')), 'hex') WHERE length("session_token") <> 64;
