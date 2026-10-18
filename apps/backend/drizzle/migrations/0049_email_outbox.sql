-- E-mail outbox, suppression list and the worker's cross-tenant entry points.
--
--   * email_outbox: every e-mail the backend sends is written here first
--     (in the same transaction as the action that caused it, where there is
--     one) and delivered by EmailOutboxWorker with exponential backoff, a
--     max attempt count, a dead state and an idempotency key per tenant.
--     Non-urgent notifications for one member are merged into one queued row
--     (batch_key) and held back over the member's quiet hours (send_after).
--     Tenant-scoped with the standard tenant_isolation policy.
--   * email_suppressions: GLOBAL, addresses that hard-bounced or complained
--     (Resend webhook). RLS on, no policy: only the functions below touch it.
--   * claim_email_outbox / finish_email_outbox: the worker has no tenant
--     context, so it claims due rows and records the outcome through these
--     two narrow functions instead of reading the table directly.
--   * record_email_event: the Resend webhook (bounce, complaint, delivery).
--   * email_outbox_stats / email_outbox_recent: the platform-admin view,
--     metadata only (no bodies, no attachments).
CREATE TABLE IF NOT EXISTS "email_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "kind" varchar(40) NOT NULL,
  "category" varchar(16) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "batch_key" varchar(120),
  "recipient" varchar(320) NOT NULL,
  "from_name" text,
  "reply_to" text,
  "bcc" text,
  "subject" varchar(300) NOT NULL,
  "html" text NOT NULL,
  "text_body" text NOT NULL,
  "headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attachments" jsonb,
  "items" jsonb,
  "status" varchar(12) DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 6 NOT NULL,
  "send_after" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_until" timestamp with time zone,
  "last_error" text,
  "provider_message_id" varchar(100),
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT IF EXISTS "email_outbox_category_check";
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_category_check" CHECK ("category" IN ('transactional', 'notification', 'digest'));
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT IF EXISTS "email_outbox_status_check";
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_status_check"
  CHECK ("status" IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'dead', 'suppressed'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_outbox_idempotency_unique" ON "email_outbox" ("tenant_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_due_idx" ON "email_outbox" ("send_after") WHERE "status" IN ('queued', 'sending');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_batch_idx" ON "email_outbox" ("tenant_id", "batch_key") WHERE "status" = 'queued';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_provider_idx" ON "email_outbox" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_outbox_status_updated_idx" ON "email_outbox" ("status", "updated_at" DESC);
--> statement-breakpoint
ALTER TABLE "email_outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "email_outbox";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "email_outbox"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "address" varchar(320) PRIMARY KEY NOT NULL,
  "reason" varchar(16) NOT NULL,
  "detail" text,
  "provider_message_id" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" DROP CONSTRAINT IF EXISTS "email_suppressions_reason_check";
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_reason_check" CHECK ("reason" IN ('bounce', 'complaint', 'manual'));
--> statement-breakpoint
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_suppressions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Due rows for the worker, locked for p_lock_seconds. Rows stuck in
-- 'sending' past their lock (a crashed worker) are picked up again; the
-- outbox id doubles as Resend's idempotency key, so that resend is safe.
-- Before claiming: rows older than p_max_age_hours die as expired (so mail
-- queued while no API key was set does not all go out weeks later), and rows
-- to a suppressed address are skipped (a complaint still lets transactional
-- mail through, a hard bounce stops everything).
DROP FUNCTION IF EXISTS claim_email_outbox(integer, integer, integer);
--> statement-breakpoint
CREATE FUNCTION claim_email_outbox(p_limit integer, p_lock_seconds integer, p_max_age_hours integer)
RETURNS SETOF email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE email_outbox o
  SET status = 'dead', last_error = 'expired', locked_until = NULL, attachments = NULL, updated_at = now()
  WHERE o.status = 'queued' AND o.created_at < now() - make_interval(hours => p_max_age_hours);

  UPDATE email_outbox o
  SET status = 'suppressed', last_error = 'suppressed: ' || s.reason, attachments = NULL, updated_at = now()
  FROM email_suppressions s
  WHERE o.status = 'queued' AND o.send_after <= now()
    AND s.address = lower(o.recipient)
    AND (s.reason <> 'complaint' OR o.category <> 'transactional');

  RETURN QUERY
  WITH due AS (
    SELECT o.id FROM email_outbox o
    WHERE (o.status = 'queued' AND o.send_after <= now())
       OR (o.status = 'sending' AND o.locked_until < now())
    ORDER BY o.send_after
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE email_outbox o
  SET status = 'sending', attempts = o.attempts + 1, locked_until = now() + make_interval(secs => p_lock_seconds), updated_at = now()
  FROM due WHERE o.id = due.id
  RETURNING o.*;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_email_outbox(integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
-- The worker's verdict on a claimed row: 'sent' (attachments dropped),
-- 'retry' (back to queued at p_retry_at) or 'dead'. Only a row still in
-- 'sending' changes, so a late duplicate verdict is a no-op.
DROP FUNCTION IF EXISTS finish_email_outbox(uuid, text, text, text, timestamp with time zone);
--> statement-breakpoint
CREATE FUNCTION finish_email_outbox(p_id uuid, p_outcome text, p_provider_id text, p_error text, p_retry_at timestamp with time zone)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE email_outbox o SET
    status = CASE p_outcome WHEN 'sent' THEN 'sent' WHEN 'retry' THEN 'queued' ELSE 'dead' END,
    provider_message_id = CASE WHEN p_outcome = 'sent' THEN left(p_provider_id, 100) ELSE o.provider_message_id END,
    sent_at = CASE WHEN p_outcome = 'sent' THEN now() ELSE o.sent_at END,
    send_after = CASE WHEN p_outcome = 'retry' THEN coalesce(p_retry_at, now()) ELSE o.send_after END,
    attachments = CASE WHEN p_outcome = 'retry' THEN o.attachments ELSE NULL END,
    last_error = CASE WHEN p_outcome = 'sent' THEN NULL ELSE left(p_error, 1000) END,
    locked_until = NULL,
    updated_at = now()
  WHERE o.id = p_id AND o.status = 'sending' AND p_outcome IN ('sent', 'retry', 'dead');
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION finish_email_outbox(uuid, text, text, text, timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
-- A verified Resend webhook event. 'delivered' only moves a 'sent' row on;
-- 'bounced' (hard) and 'complained' also put the address on the suppression
-- list. Replays are harmless.
DROP FUNCTION IF EXISTS record_email_event(text, text, text, text);
--> statement-breakpoint
CREATE FUNCTION record_email_event(p_provider_id text, p_event text, p_address text, p_detail text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event NOT IN ('delivered', 'bounced', 'complained') THEN
    RETURN;
  END IF;
  IF p_provider_id IS NOT NULL THEN
    UPDATE email_outbox o
    SET status = p_event, last_error = CASE WHEN p_event = 'delivered' THEN o.last_error ELSE left(p_detail, 1000) END, updated_at = now()
    WHERE o.provider_message_id = p_provider_id
      AND (o.status = 'sent' OR (p_event <> 'delivered' AND o.status = 'delivered'));
  END IF;
  IF p_event IN ('bounced', 'complained') AND p_address IS NOT NULL AND p_address <> '' THEN
    INSERT INTO email_suppressions (address, reason, detail, provider_message_id)
    VALUES (lower(left(p_address, 320)), CASE WHEN p_event = 'bounced' THEN 'bounce' ELSE 'complaint' END, left(p_detail, 1000), left(p_provider_id, 100))
    ON CONFLICT (address) DO NOTHING;
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION record_email_event(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
DROP FUNCTION IF EXISTS email_outbox_stats();
--> statement-breakpoint
CREATE FUNCTION email_outbox_stats()
RETURNS TABLE (status text, n bigint, oldest timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.status::text, count(*), min(o.created_at) FROM email_outbox o GROUP BY o.status
  UNION ALL
  SELECT 'suppressed_addresses', count(*), min(s.created_at) FROM email_suppressions s;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION email_outbox_stats() FROM PUBLIC;
--> statement-breakpoint
DROP FUNCTION IF EXISTS email_outbox_recent(integer, text);
--> statement-breakpoint
CREATE FUNCTION email_outbox_recent(p_limit integer, p_status text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  kind text,
  category text,
  recipient text,
  subject text,
  status text,
  attempts integer,
  last_error text,
  send_after timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.tenant_id, o.kind::text, o.category::text, o.recipient::text, o.subject::text, o.status::text,
         o.attempts, o.last_error, o.send_after, o.created_at, o.updated_at
  FROM email_outbox o
  WHERE p_status IS NULL OR o.status = p_status
  ORDER BY o.updated_at DESC
  LIMIT least(greatest(p_limit, 1), 200);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION email_outbox_recent(integer, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "email_outbox" TO faktur_app;
    GRANT EXECUTE ON FUNCTION claim_email_outbox(integer, integer, integer) TO faktur_app;
    GRANT EXECUTE ON FUNCTION finish_email_outbox(uuid, text, text, text, timestamp with time zone) TO faktur_app;
    GRANT EXECUTE ON FUNCTION record_email_event(text, text, text, text) TO faktur_app;
    GRANT EXECUTE ON FUNCTION email_outbox_stats() TO faktur_app;
    GRANT EXECUTE ON FUNCTION email_outbox_recent(integer, text) TO faktur_app;
  END IF;
END $$;
