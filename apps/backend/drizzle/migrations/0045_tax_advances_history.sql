-- OSVČ monthly advances get a history: tenants.tax_advances goes from one set
-- ({ "social": 5720, "health": 3306, "flat_tax": 9984 }) to a list of periods
-- ([{ "from": "2026-01", "social": 5720, ... }]), each valid from its month on
-- (see tax-advances.ts in @faktur/cz-compliance). An existing set becomes one
-- entry from January 2026; an empty one an empty list.
UPDATE "tenants" SET "tax_advances" = CASE
  WHEN "tax_advances" = '{}'::jsonb THEN '[]'::jsonb
  ELSE jsonb_build_array(jsonb_build_object('from', '2026-01') || "tax_advances")
END
WHERE jsonb_typeof("tax_advances") = 'object';
--> statement-breakpoint
-- The dashboard used to keep its own "Očekávané částky" per member
-- (dashboard_tiles.taxAmounts). Where the company has no advances yet, the
-- positive social / health / flat_tax amounts of one member (the owner first)
-- become its first entry; the advances are now kept only here.
WITH member_amounts AS (
  SELECT tm."tenant_id", tm."role", tm."created_at",
    (SELECT jsonb_object_agg(a.key, a.value)
       FROM jsonb_each(tm."dashboard_tiles" -> 'taxAmounts') AS a
      WHERE a.key IN ('social', 'health', 'flat_tax')
        AND jsonb_typeof(a.value) = 'number'
        AND (a.value #>> '{}')::numeric > 0
        AND (a.value #>> '{}')::numeric <= 10000000) AS amounts
  FROM "tenant_memberships" tm
  WHERE jsonb_typeof(tm."dashboard_tiles" -> 'taxAmounts') = 'object'
), picked AS (
  SELECT DISTINCT ON ("tenant_id") "tenant_id", "amounts"
  FROM member_amounts
  WHERE "amounts" IS NOT NULL
  ORDER BY "tenant_id", ("role" = 'owner') DESC, "created_at"
)
UPDATE "tenants" t
SET "tax_advances" = jsonb_build_array(jsonb_build_object('from', '2026-01') || p."amounts")
FROM picked p
WHERE t."id" = p."tenant_id" AND t."tax_advances" = '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "tax_advances" SET DEFAULT '[]'::jsonb;
