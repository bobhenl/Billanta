-- Content that writes itself, with safeguards (docs/growth-plan.md, week 2–3).
-- New AI kinds built only from our own data: tool_howto (the public
-- calculators and guides) and trade_invoicing (business presets + the
-- invoice requirements check), next to tax_deadlines. Each kind can be set to
-- publish on its own in /admin/blog; a missing row means off. The old
-- BLOG_AUTOPUBLISH_TAX_DEADLINES env switch is replaced by the tax_deadlines row.
-- auto_published marks posts that went live without a click, so the weekly
-- cap (blog-drafts.service.ts) can count them. Global table, no RLS, like
-- blog_posts.
CREATE TABLE IF NOT EXISTS "blog_autopublish" (
  "kind" varchar(16) PRIMARY KEY NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "blog_autopublish_kind_check" CHECK ("kind" IN ('tax_deadlines', 'tool_howto', 'trade_invoicing'))
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN IF NOT EXISTS "auto_published" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_posts_auto_published_idx" ON "blog_posts" ("locale", "published_at") WHERE "auto_published";
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "blog_autopublish" TO faktur_app;
  END IF;
END $$;
