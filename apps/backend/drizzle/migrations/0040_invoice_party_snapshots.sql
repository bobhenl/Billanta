-- Supplier and buyer as printed on a document on its issue date (§29, §34–35
-- ZDPH: an issued tax document keeps the data valid when it was issued).
-- Filled when a document leaves the draft stage, or from the source document
-- on import (`invoices/party-snapshot.ts`). NULL = a draft, or a document
-- issued before this migration: those keep reading the live tenant / contact
-- row, exactly as before. Existing rows are deliberately NOT backfilled.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seller_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_snapshot" jsonb;
--> statement-breakpoint
-- The public /i/:token page: company name and payment account from the
-- snapshot when the document has one (a key present with JSON null means the
-- document shows no such value); otherwise the live resolution as before.
CREATE OR REPLACE FUNCTION get_public_invoice_supplier_info(p_public_token uuid)
RETURNS TABLE (
  company_name text,
  bank_account_iban text,
  bank_account_number text,
  bank_account_bank_code varchar(4)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(nullif(i.seller_snapshot->>'companyName', ''), t.company_name),
    CASE WHEN i.seller_snapshot -> 'bankAccountIban' IS NOT NULL THEN i.seller_snapshot->>'bankAccountIban'
      ELSE coalesce(a.iban, CASE WHEN a.id IS NULL THEN t.bank_account_iban END) END,
    CASE WHEN i.seller_snapshot -> 'bankAccountNumber' IS NOT NULL THEN i.seller_snapshot->>'bankAccountNumber'
      ELSE coalesce(a.account_number, CASE WHEN a.id IS NULL THEN t.bank_account_number END) END,
    CASE WHEN i.seller_snapshot -> 'bankAccountBankCode' IS NOT NULL THEN (i.seller_snapshot->>'bankAccountBankCode')::varchar(4)
      ELSE coalesce(a.bank_code, CASE WHEN a.id IS NULL THEN t.bank_account_bank_code END) END
  FROM tenants t
  JOIN invoices i ON i.tenant_id = t.id
  LEFT JOIN LATERAL (
    SELECT b.* FROM tenant_bank_accounts b
    WHERE b.tenant_id = t.id
      AND (b.id = i.bank_account_id OR (i.bank_account_id IS NULL AND b.currency = i.currency))
    ORDER BY (b.id = i.bank_account_id) DESC, b.sort_order, b.created_at
    LIMIT 1
  ) a ON true
  WHERE i.public_token = p_public_token
  LIMIT 1;
$$;
--> statement-breakpoint
-- QR Faktura on the public page: both parties' IČO/DIČ as on the document.
CREATE OR REPLACE FUNCTION get_public_invoice_qr_details(p_public_token uuid)
RETURNS TABLE (
  supplier_ico varchar,
  supplier_dic varchar,
  supplier_vat_payer boolean,
  customer_ico varchar,
  customer_dic varchar,
  taxable_supply_date timestamptz,
  document_type text,
  reverse_charge boolean,
  exchange_rate numeric,
  order_number varchar
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE WHEN i.seller_snapshot -> 'ico' IS NOT NULL THEN (i.seller_snapshot->>'ico')::varchar ELSE t.ico END,
    CASE WHEN i.seller_snapshot -> 'dic' IS NOT NULL THEN (i.seller_snapshot->>'dic')::varchar ELSE t.dic END,
    CASE WHEN jsonb_typeof(i.seller_snapshot -> 'dicVatPayer') = 'boolean' THEN (i.seller_snapshot->>'dicVatPayer')::boolean ELSE t.dic_vat_payer END,
    CASE WHEN i.buyer_snapshot -> 'ico' IS NOT NULL THEN (i.buyer_snapshot->>'ico')::varchar ELSE c.ico END,
    CASE WHEN i.buyer_snapshot -> 'dic' IS NOT NULL THEN (i.buyer_snapshot->>'dic')::varchar ELSE c.dic END,
    i.taxable_supply_date, i.document_type::text, i.reverse_charge, i.exchange_rate, i.order_number
  FROM invoices i
  JOIN tenants t ON t.id = i.tenant_id
  LEFT JOIN contacts c ON c.id = i.contact_id
  WHERE i.public_token = p_public_token
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_public_invoice_supplier_info(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_public_invoice_qr_details(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION get_public_invoice_supplier_info(uuid) TO faktur_app;
    GRANT EXECUTE ON FUNCTION get_public_invoice_qr_details(uuid) TO faktur_app;
  END IF;
END $$;
