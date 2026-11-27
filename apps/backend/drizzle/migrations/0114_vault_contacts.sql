-- "Důvěrný režim", category "contacts": the browser seals the customer's name,
-- address, contact person, phone and note before saving (enc:v1: envelopes).
-- A sealed ZIP code does not fit in varchar(10), so the column becomes text;
-- the 10-character limit for plain values stays in the API validation.
-- IČO, DIČ, country and (unless the user chose otherwise) the e-mail stay
-- readable. No policy changes: contacts keep the standard tenant policy.
ALTER TABLE "contacts" ALTER COLUMN "address_postal_code" TYPE text;
