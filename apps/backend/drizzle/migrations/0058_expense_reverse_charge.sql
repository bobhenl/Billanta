-- Received documents in domestic reverse charge (přenesení daňové
-- povinnosti, § 92a ZDPH). The customer self-assesses the VAT: DPHDP3
-- ř. 10/11 (output) and ř. 43/44 (deduction), kontrolní hlášení B.1 with a
-- kód předmětu plnění per document. Same shape as the issued side
-- (invoices.reverse_charge, migration 0056): the code is validated by the
-- API against REVERSE_CHARGE_CODES, no CHECK here. Existing expenses keep
-- false, which is what they were treated as until now.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reverse_charge" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reverse_charge_code" text;
