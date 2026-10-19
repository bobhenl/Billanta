-- Newsletter "we'll let you know when something changes" (tax rates,
-- limits, deadlines, Slovak e-invoicing 2027). Consent-based: nobody gets an
-- issue without a confirmed opt-in (480/2004 Sb. § 7, GDPR čl. 7).
--
--   * newsletter_subscribers: GLOBAL table like blog_posts (a subscriber is
--     a person, not a company's data; most have no account). Keeps the
--     consent evidence: the wording shown, when it was given and confirmed,
--     where the form was, and when the person opted out. Double opt-in: the
--     row stays 'pending' until the link in the confirmation e-mail is
--     clicked; only a sha256 of that link's token is stored.
--   * newsletter_issues: what platform admins compose and send.
--   * email_outbox gets the 'newsletter' category. Newsletter mail has no
--     tenant (like account mail, 0062), so no tenant context can see it; it
--     is written only by enqueue_newsletter_email, which reads the recipient
--     and the consent state from newsletter_subscribers itself: an issue can
--     only be queued for a 'confirmed' subscriber, a confirmation only for a
--     'pending' one.
--   * claim_email_outbox: as in 0062, plus issues are claimed after every
--     other e-mail (a big send never delays a password reset or an invoice),
--     and a queued issue whose subscriber is no longer confirmed (opted out
--     after the send started) dies instead of going out.
CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320) NOT NULL,
  "locale" varchar(2) NOT NULL DEFAULT 'cs',
  "country" varchar(2) NOT NULL DEFAULT 'CZ',
  "topics" text[] NOT NULL DEFAULT '{}',
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "source" varchar(24) NOT NULL DEFAULT 'blog',
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "consent_text" text NOT NULL,
  "consent_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_at" timestamp with time zone,
  "unsubscribed_at" timestamp with time zone,
  "confirm_token_hash" varchar(64),
  "confirm_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "newsletter_subscribers_locale_check" CHECK ("locale" IN ('cs', 'sk', 'en')),
  CONSTRAINT "newsletter_subscribers_country_check" CHECK ("country" IN ('CZ', 'SK')),
  CONSTRAINT "newsletter_subscribers_status_check" CHECK ("status" IN ('pending', 'confirmed', 'unsubscribed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_email_unique" ON "newsletter_subscribers" (lower("email"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscribers_confirm_token_unique" ON "newsletter_subscribers" ("confirm_token_hash") WHERE "confirm_token_hash" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_user_idx" ON "newsletter_subscribers" ("user_id") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "newsletter_subscribers_audience_idx" ON "newsletter_subscribers" ("locale", "country", "id") WHERE "status" = 'confirmed';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "newsletter_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "locale" varchar(2) NOT NULL DEFAULT 'cs',
  "country" varchar(2),
  "topics" text[] NOT NULL DEFAULT '{}',
  "subject" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'draft',
  "queued_count" integer NOT NULL DEFAULT 0,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "send_started_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "newsletter_issues_locale_check" CHECK ("locale" IN ('cs', 'sk', 'en')),
  CONSTRAINT "newsletter_issues_country_check" CHECK ("country" IS NULL OR "country" IN ('CZ', 'SK')),
  CONSTRAINT "newsletter_issues_status_check" CHECK ("status" IN ('draft', 'sending', 'sent'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "newsletter_subscribers" TO faktur_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "newsletter_issues" TO faktur_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT IF EXISTS "email_outbox_category_check";
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_category_check" CHECK ("category" IN ('transactional', 'notification', 'digest', 'newsletter'));
--> statement-breakpoint
DROP FUNCTION IF EXISTS enqueue_newsletter_email(uuid, text, text, text, text, text, jsonb);
--> statement-breakpoint
-- p_kind 'newsletter_confirm' (key 'newsletter_confirm:<subscriber>:<sent at>')
-- or 'newsletter_issue' (key 'newsletter:<issue>:<subscriber>'). Returns
-- NULL when the subscriber is not in the required state or the key is
-- already queued (a resumed send), the new row's id otherwise.
CREATE FUNCTION enqueue_newsletter_email(p_subscriber_id uuid, p_kind text, p_idempotency_key text, p_subject text, p_html text, p_text text, p_headers jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_id uuid;
BEGIN
  IF p_kind = 'newsletter_confirm' THEN
    SELECT s.email INTO v_email FROM newsletter_subscribers s WHERE s.id = p_subscriber_id AND s.status = 'pending';
  ELSIF p_kind = 'newsletter_issue' THEN
    IF p_idempotency_key NOT LIKE 'newsletter:%:' || p_subscriber_id::text THEN
      RAISE EXCEPTION 'enqueue_newsletter_email: key must end with the subscriber id';
    END IF;
    SELECT s.email INTO v_email FROM newsletter_subscribers s WHERE s.id = p_subscriber_id AND s.status = 'confirmed';
  ELSE
    RAISE EXCEPTION 'enqueue_newsletter_email: unsupported kind %', p_kind;
  END IF;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO email_outbox (tenant_id, user_id, kind, category, idempotency_key, recipient, subject, html, text_body, headers, expires_at)
  VALUES (
    NULL, NULL, p_kind,
    CASE WHEN p_kind = 'newsletter_issue' THEN 'newsletter' ELSE 'notification' END,
    left(p_idempotency_key, 200), v_email, left(p_subject, 300), p_html, p_text, coalesce(p_headers, '{}'::jsonb),
    CASE WHEN p_kind = 'newsletter_confirm' THEN now() + interval '24 hours' ELSE NULL END
  )
  ON CONFLICT ("idempotency_key") WHERE "tenant_id" IS NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION enqueue_newsletter_email(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
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
  SET status = 'dead', last_error = 'unsubscribed', locked_until = NULL, updated_at = now()
  WHERE o.status = 'queued' AND o.tenant_id IS NULL AND o.kind = 'newsletter_issue'
    AND NOT EXISTS (
      SELECT 1 FROM newsletter_subscribers s
      WHERE s.status = 'confirmed' AND s.id::text = split_part(o.idempotency_key, ':', 3)
    );

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
    ORDER BY (o.category = 'newsletter'), (o.tenant_id IS NOT NULL), o.send_after
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
    GRANT EXECUTE ON FUNCTION enqueue_newsletter_email(uuid, text, text, text, text, text, jsonb) TO faktur_app;
  END IF;
END $$;
