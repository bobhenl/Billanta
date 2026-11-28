-- Daily check of the EPO form schemas (XSD) the finanční správa publishes.
-- Each morning the backend fetches the XSD of every form Billanta exports and
-- validates sample exports against it. A form whose samples fail is blocked
-- (export refused with 409 form_blocked) until a fixed generator passes again;
-- nothing is fixed automatically. The XSD is kept to validate real exports too.
-- Global table (no tenant_id): only the cron, the export guard and admins use it.
CREATE TABLE IF NOT EXISTS "form_schemas" (
  "form" varchar(20) PRIMARY KEY,
  "url" text NOT NULL,
  "hash" text,
  "xsd" text,
  "status" varchar(16) NOT NULL DEFAULT 'ok',
  "errors" text,
  "last_error" text,
  "last_checked_at" timestamp with time zone,
  "last_changed_at" timestamp with time zone,
  "blocked_at" timestamp with time zone
);
