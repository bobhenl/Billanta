-- Account e-mails (password reset, sign-in e-mail change) through the outbox.
--
-- The frontend used to hand them straight to Resend: they predate the
-- outbox, and the outbox is keyed on a tenant while these belong to a user
-- who may have no company yet. A direct send has no retry, so one Resend
-- 429 or 5xx lost the link for good. Now:
--   * tenant_id is nullable. A row without a tenant is an account e-mail.
--     The tenant_isolation policy compares tenant_id to the current tenant,
--     which is never true for NULL, so no tenant context can see these rows;
--     only the SECURITY DEFINER functions below and in 0049 touch them.
--   * expires_at: the link inside is valid for an hour, so a mail still
--     undelivered past that dies instead of going out with a dead link.
--   * enqueue_account_email: the only way to write such a row. It accepts
--     the two account kinds only and always queues them as transactional,
--     so they never wait for batching or quiet hours, and a complaint does
--     not suppress them (0049). The daily sending caps in src/abuse/ cover
--     a company's mail to its customers and never applied to these.
--   * claim_email_outbox takes account mail first, so a backlog of invoice
--     mail does not delay a password reset.
ALTER TABLE "email_outbox" ALTER COLUMN "tenant_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
-- The (tenant_id, idempotency_key) index treats NULL tenants as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS "email_outbox_account_idempotency_unique" ON "email_outbox" ("idempotency_key") WHERE "tenant_id" IS NULL;
--> statement-breakpoint
DROP FUNCTION IF EXISTS enqueue_account_email(text, text, text, text, text, uuid, integer);
--> statement-breakpoint
CREATE FUNCTION enqueue_account_email(p_kind text, p_recipient text, p_subject text, p_html text, p_text text, p_user_id uuid, p_valid_minutes integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_kind NOT IN ('password_reset', 'email_change') THEN
    RAISE EXCEPTION 'enqueue_account_email: unsupported kind %', p_kind;
  END IF;
  IF coalesce(btrim(p_recipient), '') = '' THEN
    RAISE EXCEPTION 'enqueue_account_email: recipient is required';
  END IF;
  INSERT INTO email_outbox (tenant_id, user_id, kind, category, idempotency_key, recipient, subject, html, text_body, expires_at)
  VALUES (
    NULL, p_user_id, p_kind, 'transactional', p_kind || ':' || gen_random_uuid()::text,
    left(btrim(p_recipient), 320), left(p_subject, 300), p_html, p_text,
    now() + make_interval(mins => least(greatest(coalesce(p_valid_minutes, 60), 1), 1440))
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION enqueue_account_email(text, text, text, text, text, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
-- As in 0049, plus: rows past expires_at die as expired, and account mail
-- (no tenant) is claimed before everything else.
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
  WHERE o.status = 'queued'
    AND (o.created_at < now() - make_interval(hours => p_max_age_hours) OR o.expires_at < now());

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
    ORDER BY (o.tenant_id IS NOT NULL), o.send_after
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
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION claim_email_outbox(integer, integer, integer) TO faktur_app;
    GRANT EXECUTE ON FUNCTION enqueue_account_email(text, text, text, text, text, uuid, integer) TO faktur_app;
  END IF;
END $$;
