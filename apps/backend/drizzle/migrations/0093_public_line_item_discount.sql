-- The public invoice page (/i/:token) summed quantity × price without the
-- line discount, so its total, payment QR and card amount could differ from
-- the PDF. get_public_invoice_line_items now returns discount_percent too.
-- The row type changes, hence the DROP: CREATE OR REPLACE cannot change a
-- function's result columns.
DROP FUNCTION IF EXISTS get_public_invoice_line_items(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_public_invoice_line_items(p_public_token uuid)
RETURNS TABLE (
  description text,
  quantity numeric(12,3),
  unit_price numeric(14,4),
  vat_rate numeric(5,2),
  sort_order integer,
  discount_percent numeric(5,2)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ili.description,
    ili.quantity,
    ili.unit_price,
    ili.vat_rate,
    ili.sort_order,
    ili.discount_percent
  FROM invoice_line_items ili
  JOIN invoices i ON i.id = ili.invoice_id
  WHERE i.public_token = p_public_token
  ORDER BY ili.sort_order;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION get_public_invoice_line_items(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faktur_app') THEN
    GRANT EXECUTE ON FUNCTION get_public_invoice_line_items(uuid) TO faktur_app;
  END IF;
END $$;
