-- "Kontaktní osoba odběratele": the person to deal with at the customer.
--
--   * contacts.contact_person: kept on the customer and offered on every new
--     document for them.
--   * invoices.buyer_contact_person: what this document prints in the buyer
--     block. Copied from the contact when the customer is picked and editable
--     per document, so it is already fixed per invoice and stays as it was
--     on issued documents when the contact changes later.
--
-- Both nullable and empty for existing rows; nothing is backfilled here.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "contact_person" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer_contact_person" text;
