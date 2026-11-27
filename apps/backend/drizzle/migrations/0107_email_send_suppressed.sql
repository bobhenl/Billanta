-- Důvěrný režim: a sealed invoice's PDF/ISDOC is rendered in the browser and
-- may pass through the server once to be attached to the e-mail. It must not
-- sit in email_outbox.attachments, so that one e-mail is delivered straight
-- away instead of through the worker. The worker skips suppressed addresses
-- in claim_email_outbox (0049); this lets the direct path ask the same
-- question without reading email_suppressions, which faktur_app cannot.
CREATE OR REPLACE FUNCTION email_send_suppressed(p_recipient text, p_category text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM email_suppressions s
    WHERE s.address = lower(trim(p_recipient))
      AND (s.reason <> 'complaint' OR p_category <> 'transactional')
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION email_send_suppressed(text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION email_send_suppressed(text, text) TO faktur_app;
  END IF;
END $$;
