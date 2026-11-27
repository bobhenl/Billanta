-- PSD2 consent runs out after 90–180 days and the bank stops sending
-- payments until someone renews it. The daily ConsentExpiryCron warns a week
-- ahead and on the last day; this column remembers the smallest warning
-- already sent (7 or 1) so each goes out once per connection. Renewing the
-- consent (completePsd2) sets it back to null. Covered by the existing
-- bank_connections RLS policy and table grants.
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "consent_warned_days" smallint;
--> statement-breakpoint
ALTER TABLE "bank_connections" DROP CONSTRAINT IF EXISTS "bank_connections_consent_warned_days_check";
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_consent_warned_days_check" CHECK ("consent_warned_days" IS NULL OR "consent_warned_days" IN (1, 7));
