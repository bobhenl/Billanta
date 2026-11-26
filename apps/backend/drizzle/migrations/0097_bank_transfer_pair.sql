-- A PayPal withdrawal and the bank credit it became point at each other, so
-- the credit is shown as the company's own transfer, not as income.
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "transfer_pair_id" uuid;
--> statement-breakpoint
ALTER TABLE "bank_transactions" DROP CONSTRAINT IF EXISTS "bank_transactions_transfer_pair_id_fk";
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_transfer_pair_id_fk" FOREIGN KEY ("transfer_pair_id") REFERENCES "bank_transactions"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_transactions_transfer_pair_idx" ON "bank_transactions" ("transfer_pair_id");
