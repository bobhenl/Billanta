-- Kód předmětu plnění for domestic reverse charge (§ 92a–92i ZDPH).
-- Kontrolní hlášení A.1 (VetaA1 kod_pred_pl) needs one per document and EPO
-- rejects the row without it. The person picks it in the invoice form from
-- REVERSE_CHARGE_CODES (cz-compliance), which the API validates; no CHECK
-- here, so a change in the official číselník needs no migration. Existing
-- documents stay null: the KH export reports them instead of guessing.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "reverse_charge_code" text;
