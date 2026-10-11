-- Partial payments (bitfaktura-style "uhrazeno"): the running sum received
-- so far. The document stays "issued" until it reaches the total.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amount_paid" numeric(14, 2) NOT NULL DEFAULT 0;
