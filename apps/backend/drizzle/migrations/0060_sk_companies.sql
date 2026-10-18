-- A local copy of the active part of the Slovak register (RPO), for the SK
-- company typeahead. The live RPO search answers our VPS in 6.6-8.7 s; this
-- table answers in milliseconds. Filled from the RPO bulk export (monthly
-- snapshot + nightly deltas, CC BY 4.0) by importSkCompanies, see the
-- backend README ("Slovak company index"). faktur_app gets its table
-- rights from app-role-grants.sql (ALL TABLES), re-run after every migrate.
--
-- GLOBAL, no tenant_id and no RLS: public register data, the same for every
-- tenant, like ares_cache. Only active subjects are kept (~1 M rows, about
-- 130 MB of data plus the indexes). name_norm is the name folded in JS
-- (foldCompanyName: lowercase, no diacritics), so the trigram index serves
-- `name_norm LIKE '%…%'` without needing the unaccent extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sk_companies" (
  "rpo_id" bigint PRIMARY KEY,
  "ico" varchar(8) NOT NULL,
  "name" text NOT NULL,
  "name_norm" text NOT NULL,
  "street" text,
  "city" text,
  "postal_code" varchar(10),
  "legal_form" varchar(3),
  "established_on" date,
  "synced_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Not unique: about 24 000 active RPO subjects share their IČO with another one.
CREATE INDEX IF NOT EXISTS "sk_companies_ico_idx" ON "sk_companies" ("ico");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sk_companies_name_trgm_idx" ON "sk_companies" USING gin ("name_norm" gin_trgm_ops);
--> statement-breakpoint
-- One row: how far the import got. The index is used only while the data
-- is recent (see skIndexUsable), so a stopped cron falls back to live RPO.
CREATE TABLE IF NOT EXISTS "sk_companies_sync" (
  "id" smallint PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "init_date" date,
  "daily_date" date,
  "row_count" integer NOT NULL DEFAULT 0,
  "finished_at" timestamp with time zone,
  "last_error" text
);
