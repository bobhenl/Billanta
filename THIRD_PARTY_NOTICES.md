# Third-party notices

## faktorio

Parts of this project are ported or adapted from
[faktorio](https://github.com/capaj/faktorio), used under the MIT License:

- `packages/cz-compliance/` — ARES/VIES lookup, ISDOC export, SPAYD QR, bank account validation
- `apps/backend/src/exports/cnb-rates.ts` — ČNB exchange rates
- `apps/backend/src/exports/vat-returns.ts` — VAT filings (DPHDP3, DPHKH1, DPHSHV)
- `apps/backend/src/tenants/bank-accounts.ts` — multiple bank accounts per company (concept)
- `apps/backend/src/invoices/invoice-pdf.service.ts` — company logo in the document header (concept)
- `apps/backend/drizzle/rls-policies.sql` (`record_public_invoice_view`) — share-link view stats (concept)
- `packages/cz-compliance/src/working-days.ts` — Czech public holidays and working days
- `packages/cz-compliance/src/rpo-client.ts` — Slovak RPO company lookup (concept)
- `apps/backend/src/me/account-deletion.service.ts`, `settings/profile/actions.ts` (deleteAccount, requestEmailChange), `app/api/auth/confirm-email` — account deletion and sign-in email change (concept)
- `apps/backend/src/contacts/contacts-csv.util.ts`, `contacts/contacts-csv.tsx` — contacts CSV import/export (concept and faktorio column names)

Further files derived from faktorio name it in their header comment.

```
MIT License

Copyright (c) 2024-now Jiri Spac

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled browser libraries

- **pdf.js** (`pdfjs-dist`, Mozilla, Apache-2.0): `apps/frontend/public/pdfjs/`
  is a verbatim copy of `pdfjs-dist/build/pdf.min.mjs` and
  `pdf.worker.min.mjs`, used to find the QR code on a received PDF invoice.
  Licence: https://github.com/mozilla/pdf.js/blob/master/LICENSE
- **jsQR** (Cosmo Wolfe, Apache-2.0), npm dependency for decoding QR codes.
- **DejaVu Sans** fonts (Bitstream Vera / DejaVu licence, public-domain changes):
  `apps/frontend/assets/og/DejaVuSans*.ttf`, verbatim copies used to render the
  Open Graph cards (`app/og/`). Licence text: `apps/frontend/assets/og/DejaVu-LICENSE.txt`.

The QR Faktura (SID) and QR Platba (SPAYD) formats are public specifications
of the Czech Banking Association (qr-faktura.cz, qr-platba.cz).

## Backup libraries (npm dependencies of apps/backend)

- **age-encryption** (Filippo Valsorda, BSD-3-Clause): encrypts backup files in
  the age format (age-encryption.org), `src/backup-destinations/age.util.ts`.
- **ssh2** (Brian White, MIT) and **ssh2-sftp-client** (Tim Cross, Apache-2.0):
  uploads backups to the company's own SFTP server, `src/backup-destinations/sftp.client.ts`.

## Accounting software formats

- **Pohoda XML** (STORMWARE): the export follows the published dataPack schemas.
- **Money S3 XML** (Solitea): the export in `apps/backend/src/exports/exports.service.ts`
  follows the `MoneyData` XSD that Solitea publishes. It was checked against the
  copy of that XSD in the `money_s3` Ruby gem (Přemysl Donát, MIT). The gem is not
  bundled, and no code from it was taken.
- **Peppol BIS Billing 3.0 / EN 16931** (OpenPeppol, CEN): `validatePeppolInvoice` in
  `packages/cz-compliance/src/ubl-generator.ts` checks a subset of the published business
  rules (BR-*, PEPPOL-EN16931-R*), by rule id. The schematron files are not bundled.

## Public registers and open data (queried at runtime, nothing bundled)

- **ARES** (Ministry of Finance CZ): company data and standardised addresses (RÚIAN).
- **RPO** (Statistical Office of the Slovak Republic, `api.statistics.sk`), CC BY 4.0.
- **Recherche d'entreprises** (`recherche-entreprises.api.gouv.fr`, DINUM), Licence Ouverte / Etalab 2.0.
- **Enhetsregisteret** (Brønnøysundregistrene, `data.brreg.no`), NLOD 2.0.
- **Biała lista podatników VAT** (Ministry of Finance PL, `wl-api.mf.gov.pl`).
- **VIES** (European Commission): EU VAT number validation.
- **GLEIF** (Global Legal Entity Identifier Foundation, `api.gleif.org`): LEI
  records, CC0 1.0 — used for DE/AT/IT/US/worldwide company search.
- **UK Companies House** public data API (optional, own API key): Open
  Government Licence v3.0 — "Contains public sector information licensed under
  the Open Government Licence v3.0."
- **YTJ / PRH open data** (Finnish Patent and Registration Office,
  `avoindata.prh.fi`), CC BY 4.0.
- **cvrapi.dk** (free CVR lookup over the Danish Central Business Register,
  Erhvervsstyrelsen): Danish company search.
- **UID-Register** (Swiss Federal Statistical Office, `uid-wse.admin.ch`
  public services): Swiss company search.
- **Photon** (komoot, `photon.komoot.io`) over **OpenStreetMap** data,
  © OpenStreetMap contributors, ODbL 1.0: address suggestions outside CZ.

## Banking APIs (called at runtime, nothing bundled)

- **Fio banka API** (`fioapi.fio.cz`): read-only account statements for Fio clients.
- **Enable Banking API** (Enable Banking Oy, `api.enablebanking.com`): licensed
  PSD2 account information for other banks, `apps/backend/src/bank-reconciliation/enable-banking-client.ts`.
  Used under the operator's own Enable Banking agreement.
- **PayPal Transaction Search API** (PayPal, `api-m.paypal.com`): received
  payments and fees of the tenant's own PayPal account,
  `apps/backend/src/bank-reconciliation/paypal-client.ts`. Each tenant uses
  its own PayPal REST app credentials.

## Product inspiration (no code taken)

Some features follow ideas seen in other invoicing products: bitfaktura
(entering prices incl. VAT, a paid-on column in the invoice list), Fakturoid,
Invoice Ninja (a public company profile page; a per-customer client portal
listing all their documents; projects with tasks billed
at an hourly rate) and InvoiceOcean. Paying an invoice by card from its link follows the "pay online" option of
Fakturoid and Invoice Ninja. Time tracking follows the timer-and-invoice
flow of Fakturoid and Invoice Ninja. The invoice
history import (`apps/backend/src/invoices/invoice-import.util.ts`) recognises
the column headers of CSV exports from Fakturoid, iDoklad, bitfaktura, faktorio
and Invoice Ninja; only the header names are matched. Nothing from their code or
assets is included, so no licence terms apply.
