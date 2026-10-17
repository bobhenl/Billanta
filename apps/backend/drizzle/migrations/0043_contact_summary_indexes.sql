-- Indexes for the contact hover card (GET /v1/contacts/:id/summary) and the
-- per-invoice line-item lookups: invoices of one customer, items of one invoice.
CREATE INDEX IF NOT EXISTS "invoices_tenant_contact_idx" ON "invoices" ("tenant_id", "contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_items_invoice_idx" ON "invoice_line_items" ("invoice_id");
