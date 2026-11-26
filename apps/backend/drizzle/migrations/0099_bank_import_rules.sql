-- The "only download movements containing" filter moves from the bank
-- connection's edit form into the bank rules, as an `import_only` rule with
-- the words in conditions.keywords and an optional connection scope
-- (connection_id; null means every PSD2 connection). The sync reads those
-- rules before it stores anything, exactly as it read import_filter.
-- Each connection with a filter gets an equivalent rule scoped to it. The
-- import_filter column stays (unread) so the previous release still works on
-- a rollback; NOT EXISTS keeps a re-run from adding a second copy.
ALTER TABLE "bank_rules" ADD COLUMN IF NOT EXISTS "connection_id" uuid;
--> statement-breakpoint
ALTER TABLE "bank_rules" DROP CONSTRAINT IF EXISTS "bank_rules_connection_id_fk";
--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "bank_connections"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "bank_rules" DROP CONSTRAINT IF EXISTS "bank_rules_action_check";
--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_action_check" CHECK ("action" IN ('ignore', 'draft_expense', 'draft_invoice', 'import_only'));
--> statement-breakpoint
INSERT INTO "bank_rules" ("tenant_id", "name", "enabled", "position", "conditions", "action", "connection_id")
SELECT
  c."tenant_id",
  left(coalesce(nullif(btrim(c."label"), ''), nullif(btrim(c."bank_name"), ''), 'Bank'), 100),
  true,
  coalesce((SELECT max(r."position") FROM "bank_rules" r WHERE r."tenant_id" = c."tenant_id"), -1)
    + row_number() OVER (PARTITION BY c."tenant_id" ORDER BY c."created_at", c."id"),
  jsonb_build_object('text', '[]'::jsonb, 'direction', 'any', 'keywords', btrim(c."import_filter")),
  'import_only',
  c."id"
FROM "bank_connections" c
WHERE btrim(coalesce(c."import_filter", '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "bank_rules" r WHERE r."connection_id" = c."id" AND r."action" = 'import_only'
  );
