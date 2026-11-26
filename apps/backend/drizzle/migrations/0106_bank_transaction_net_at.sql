-- A PayPal payment kept on a USD balance gets its real home value only when
-- PayPal converts the balance, often weeks later at a withdrawal. The invoice
-- detail shows that day ("Převedeno 2. 11. 2026"), so it is stored with it.
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "net_at" timestamp with time zone;
