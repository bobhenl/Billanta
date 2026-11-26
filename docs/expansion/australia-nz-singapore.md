# Australia, New Zealand and Singapore

Status: country packs only (`supportLevel: 'pack'`), data checked on
2026-10-28. Code: `packages/cz-compliance/src/countries/{au,nz,sg}/`, tests in
`src/__tests__/countries-au-nz-sg.test.ts`. The packs are not registered in
`COUNTRY_PACKS` yet.

## Why these three together

All three are English-speaking GST countries with Peppol as the e-invoicing
network (AU and NZ share the PINT A-NZ specification, SG uses PINT SG under
the InvoiceNow brand). One English UI, one Peppol access point and one GST
model cover most of what they need. They differ in the details: who must be
named on an invoice, holiday calendars and how far e-invoicing is mandatory.

## Market

- **Australia** – the largest of the three by far. Sole traders and small
  companies register an ABN for free; GST registration is required from
  AUD 75,000 turnover, so a big share of freelancers invoice without GST.
  Cloud accounting is the norm and the ATO pushes digital lodgment.
- **New Zealand** – small but highly digital, with very high cloud
  accounting adoption among small businesses. The GST threshold is
  NZD 60,000. The 2023 invoicing reform ("taxable supply information")
  removed the "Tax invoice" title rule and made invoices simpler.
- **Singapore** – a regional hub with many small companies and foreign
  owners. GST registration only from SGD 1 million turnover, so most small
  businesses are not GST-registered – but InvoiceNow is becoming the
  default channel and is now required for new voluntary GST registrants.

For a CZ/SK-born product the realistic target is freelancers and micro
businesses that find full accounting suites too heavy, not accountants.

## Competitors (in our own words)

- **Xero** – started in New Zealand and is the default choice for small
  businesses in AU and NZ, with a large accountant network and app
  marketplace. Full double-entry accounting; invoicing is one module of
  many. Strong bank feeds and Peppol support. Pricing is per organisation
  and has risen over time, which leaves room for a cheaper invoicing-first
  tool.
- **MYOB** – an Australian vendor with a long desktop history, now mostly
  cloud. Strong in payroll and with older, established firms and their
  bookkeepers. Broad but heavier than a freelancer needs.
- **Reckon** – Australian, aimed at price-sensitive small businesses and
  sole traders, with simple cloud and desktop products. Smaller ecosystem
  than Xero or MYOB.
- In Singapore, Xero and QuickBooks are common, alongside local tools
  focused on InvoiceNow and government grants for digital adoption.

Our angle: invoicing first, mobile, voice-to-draft (AI never issues), fair
flat pricing, and Peppol built in rather than a paid add-on.

## Tax and invoicing rules (summary of the packs)

| | Australia | New Zealand | Singapore |
|---|---|---|---|
| Tax ID on invoice | ABN (mod 89) | GST number = IRD number (mod 11) | GST Reg. No. (UEN or M-format) |
| Company ID | ABN / ACN | NZBN (GS1) | UEN |
| GST rate | 10 % since 2000 | 15 % since 2010 (10 %, 12.5 % before) | 9 % since 2024 (3 % → 9 %) |
| Registration threshold | AUD 75,000 | NZD 60,000 | SGD 1,000,000 |
| Title | "Tax invoice" | none required since 2023 | "Tax Invoice" (simplified: none) |
| Buyer identity | from AUD 1,000 | over NZD 1,000 (name + one identifier) | full tax invoice (over SGD 1,000) |
| Retention | 5 years | 7 years | 5 years |
| E-invoicing | Peppol B2G (in force), B2B voluntary | Peppol B2G: agencies 2026, large suppliers 2027-01-01 | InvoiceNow B2G; GST InvoiceNow for new voluntary registrants (2025-11-01, 2026-04-01) |
| GST returns | BAS quarterly 28th (Q2: 28 Feb), monthly 21st | 28th of next month (Nov → 15 Jan, Mar → 7 May) | F5 one month after the period |
| Payments | BSB + account, PayID, BPAY | bank account 2-4-7-2/3 | PayNow QR (SGQR), FAST, GIRO |
| Registry | ABN Lookup (free API, GUID) | NZBN API (key) | ACRA Bizfile; open data on data.gov.sg |

Sources are listed in each pack (`sources`) and next to each rule.

## Privacy law

- **Australia – Privacy Act 1988 and the Australian Privacy Principles.**
  Businesses with annual turnover of AUD 3 million or less are mostly
  exempt, but the exemption has exceptions (for example businesses that
  trade in personal information) and reform proposals aim to remove it, so
  we should plan to comply in full. The
  Notifiable Data Breaches scheme requires telling the OAIC and affected
  people about eligible breaches. APP 8 makes us accountable for overseas
  disclosure (our EU hosting) – we need a clear privacy policy and
  contractual safeguards.
- **New Zealand – Privacy Act 2020** with 13 Information Privacy
  Principles. Notifiable privacy breaches go to the Privacy Commissioner.
  IPP 12 limits disclosure abroad unless the recipient gives comparable
  protection; the EU GDPR regime is generally treated as comparable, and NZ
  has an EU adequacy decision.
- **Singapore – Personal Data Protection Act 2012.** Consent, purpose
  limitation, a named Data Protection Officer, mandatory breach notification
  to the PDPC for significant breaches, and a transfer limitation obligation
  for data leaving Singapore (contractual clauses suffice).

Our GDPR setup (DPA, sub-processor list, breach process) covers most of
this; each country needs a local privacy notice and a named contact.

## Gaps before launch

Size: **S** = days, **M** = 1–3 weeks, **L** = a month or more.

| Gap | Size | Notes |
|---|---|---|
| Register the packs in `COUNTRY_PACKS` and export them | S | Left out on purpose in this change. |
| English (en-AU / en-NZ / en-SG) wording: "Tax invoice", GST labels, date format | S | `en` exists; country variants mostly need date and number formats. |
| Invoice templates per country (title, buyer rule by amount, "Total includes GST" line) | M | NZ two-tier rules and SG simplified invoice need amount-dependent fields. |
| ABN Lookup client (ABN → name, GST status) | S | Free API with a GUID; similar to the ARES client. |
| NZBN API client | S | Needs an MBIE API subscription key. |
| ACRA lookup from data.gov.sg | M | Open dataset, no direct per-UEN API; may need a local index. |
| Peppol access point (PINT A-NZ, PINT SG) | L | Needs an accredited AP partner; shared with the EU Peppol work. |
| SG GST InvoiceNow reporting | M | Send invoice data to IRAS via the AP by the return due date; depends on the AP. |
| PayNow QR (SGQR / EMVCo payload) | M | New QR generator next to SPAYD and Pay by Square. |
| PayID / BPAY details on AU invoices | S | Display only; no QR standard. |
| State holidays (AU) and anniversary days (NZ) | M | Needs a subdivision on the tenant and in `holidays()`. |
| SG holiday table each year | S | Lunar holidays must be added yearly from the MOM gazette. |
| GST return helpers (BAS, NZ GST101A, SG F5 figures) | L | Calendar dates are in the packs; the return values are not. |
| Local privacy notices (AU, NZ, SG) and a DPO contact for SG | S | Legal review needed. |
| Pricing in AUD / NZD / SGD and local payment for subscriptions | M | Billing side, not compliance. |

## Contract gaps found while writing the packs

1. `validateDomesticAccount` takes one string; AU BSB and account number are
   two fields in practice.
2. `EInvoiceMandate.model` has no value for "report to the tax authority via
   Peppol by the return due date" (SG GST InvoiceNow). Modelled as
   `peppol_exchange`.
3. No way to describe a voluntary network (B2B Peppol in AU and NZ).
4. `holidays(year)` has no subdivision parameter (AU states, NZ regions).
5. One `simplifiedThreshold` only; NZ has two tiers (NZD 200 and 1,000).
6. No way to say "title not required" other than leaving `title` out (NZ).
7. Lunar calendar holidays (SG) cannot be computed and need a yearly table.
