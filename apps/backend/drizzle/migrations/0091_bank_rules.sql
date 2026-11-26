-- Bank rules ("Pravidla pro platby"): per-company rules that act on bank
-- payments no invoice matched. A rule ignores the payment or turns it into a
-- draft to review (an expense flagged needs_review, or a pending_review
-- invoice). Nothing final is ever created by a rule.
--   * bank_rules: the rules, ordered by position; first fitting rule wins.
--   * bank_transactions.applied_rule_id: which rule acted, for "Ignorováno
--     pravidlem X" in the list.
--   * bank_transactions.matched_expense_id: the expense a rule drafted from
--     an outgoing payment.
--   * expenses.needs_review: set on rule-made expenses until a person saves
--     them in the expense form.
-- bank_rules is a tenant table with the standard tenant_isolation policy.
CREATE TABLE IF NOT EXISTS "bank_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "conditions" jsonb NOT NULL,
  "action" varchar(32) NOT NULL,
  "expense_category" text,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_rules" DROP CONSTRAINT IF EXISTS "bank_rules_action_check";
--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_action_check" CHECK ("action" IN ('ignore', 'draft_expense', 'draft_invoice'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_rules_tenant_position_idx" ON "bank_rules" ("tenant_id", "position");
--> statement-breakpoint
ALTER TABLE "bank_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bank_rules";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_rules"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "applied_rule_id" uuid;
--> statement-breakpoint
ALTER TABLE "bank_transactions" DROP CONSTRAINT IF EXISTS "bank_transactions_applied_rule_id_fk";
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_applied_rule_id_fk" FOREIGN KEY ("applied_rule_id") REFERENCES "bank_rules"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "matched_expense_id" uuid;
--> statement-breakpoint
ALTER TABLE "bank_transactions" DROP CONSTRAINT IF EXISTS "bank_transactions_matched_expense_id_fk";
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_expense_id_fk" FOREIGN KEY ("matched_expense_id") REFERENCES "expenses"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "needs_review" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Migrations run as the table owner; grant here too when the app role
-- already exists (app-role-grants.sql covers it again after every migrate).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_rules" TO faktur_app;
  END IF;
END
$$;
