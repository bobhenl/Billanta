-- Kurz u faktur v cizí měně split into two choices (exchange-rate-mode.ts):
-- what invoices print (daily ČNB rate or no conversion) and which rate
-- reports and the income-tax estimate use (daily or the jednotný kurz).
-- The old single value "annual" printed the annual rate on invoices, which
-- VAT does not allow (§ 38 ZDPH needs the rate of the DUZP). It becomes
-- daily on invoices + annual in reports. The code reads an unmigrated
-- "annual" the same way, so this only tidies the stored prefs. Issued
-- documents keep their stored rate and mode.
UPDATE "tenants"
SET "invoice_form_prefs" = "invoice_form_prefs" || '{"exchangeRateMode": "cnb_daily", "reportRateMode": "annual"}'::jsonb
WHERE "invoice_form_prefs"->>'exchangeRateMode' = 'annual';
