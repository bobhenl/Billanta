# Canada (CA)

Research notes behind the CA country pack
(`packages/cz-compliance/src/countries/ca/`). Checked 2026-10-28. Things we
could not confirm from a primary source are listed in the pack's `caveats`
and repeated at the end of this file.

## Market

- About 1.2 million employer businesses, almost all of them small (under
  100 employees), plus roughly 2.5–3 million self-employed people
  ([ISED – Key Small Business Statistics](https://ised-isde.canada.ca/site/sme-research-statistics/en/key-small-business-statistics);
  [Statistics Canada – Labour Force Survey](https://www150.statcan.gc.ca/n1/en/subjects/labour/employment_and_unemployment)).
  Our target is the self-employed and micro businesses, the same as in CZ/SK.
- Two official languages. Québec (about 22 % of the population) needs a
  French UI and French invoices; the rest of the country works in English.
- Billanta is already hosted in Canada, which helps with Canadian customers'
  data-residency questions (see Law 25 below for the Québec nuance).
- Tax is federal plus provincial: one federal GST, five provinces that
  harmonize it into one HST, and three provinces plus Québec that charge their
  own sales tax next to it. Getting this right per customer province is the
  main product work.

## Tax facts used in the pack

| Topic | Rule | Source |
|---|---|---|
| GST | 5 % federally, since 2008-01-01 | [CRA rates](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html) |
| HST | ON 13 %, NB/NL/PE 15 %, NS 14 % since 2025-04-01 (15 % before) | same |
| PST/QST | BC 7 %, SK 6 %, MB 7 % (RST), QC 9.975 % (QST), all on top of the GST | same, plus provincial sites |
| AB, NT, NU, YT | GST only | same |
| Small supplier | taxable supplies of CAD 30,000 or less in a quarter and over four consecutive quarters: no obligation to register (ETA s. 148) | [CRA – registering](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/register-gst-hst/register.html) |
| Invoice content | the buyer needs the information for an input tax credit, in three tiers: under CAD 100 – supplier name, date, total; CAD 100–499.99 – plus the GST/HST number and the tax (or "tax included" plus the rate); CAD 500 and up – plus buyer name, payment terms, description of each supply | [SOR/91-45 s. 3](https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-45/section-3.html) |
| Business Number | 9 digits, Luhn check digit; GST/HST account `RT0001` | [CRA – BN](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/registering-your-business/you-need-a-business-number-a-program-account.html) |
| QST number | 10 digits + `TQ` + 4 digits | [Revenu Québec](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/) |
| Records | keep 6 years from the end of the year | [CRA – keeping records](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records/where-keep-your-records-long-request-permission-destroy-them-early.html) |
| Returns | GST/HST monthly or quarterly: one month after the period. Annual filers who are individuals with a 31 Dec year-end: file by 15 June, pay by 30 April. T1: 30 April, self-employed 15 June | [CRA – when to file](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/file-gst-hst-return/when-file-gst-hst-return.html) |
| Holidays | federal general holidays, Canada Labour Code s. 166 | [Justice Laws](https://laws-lois.justice.gc.ca/eng/acts/L-2/section-166.html) |
| E-invoicing | no mandate (B2B, B2G) as of 2026-10 | – |
| Payments | Interac e-Transfer, EFT/direct deposit (transit 5 + institution 3 + account 7–12), cheques still common | [Payments Canada](https://www.payments.ca/our-directories/financial-institutions-routing-numbers) |

The task brief gave the invoice tiers as CAD 30 / 150. Those are the
amounts from before 2021; the regulation in force says CAD 100 / 500, and
the pack follows the regulation.

## Competitors

Described in our own words, from their public product pages.

- **Wave** – free-to-start bookkeeping and invoicing aimed at Canadian and US
  freelancers (the company started in Toronto). It earns money on card
  payments, payroll and paid plans. Strong brand among the self-employed;
  sales-tax handling is mostly manual tax rates the user sets up.
- **FreshBooks** – a Toronto-built invoicing and time-tracking tool for
  service businesses, with expenses, projects and accounting on higher plans.
  Polished UX and strong in agencies and consultants; priced per month with
  client limits on the lower plans.
- **QuickBooks Online** (Intuit) – the default accounting package for
  Canadian bookkeepers and accountants, with GST/HST and QST return support.
  Broad and powerful, but heavy for a sole proprietor who only needs
  invoices.
- Others worth watching: Sage Accounting, Xero (smaller in Canada), Zoho
  Invoice, and Québec-focused tools such as Acomba.

Where Billanta can win: a simpler, invoicing-first product for
freelancers, correct GST/HST/PST/QST by customer province out of the box,
French and English invoices side by side for Québec, voice-to-draft
invoicing, and Canadian hosting.

## Legal and privacy

- **PIPEDA** applies to private-sector personal information in provinces
  without their own equivalent law: consent, purpose limitation, safeguards
  and breach reporting to the Privacy Commissioner when there is a "real risk
  of significant harm"
  ([OPC – PIPEDA](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/)).
  Alberta and British Columbia have their own private-sector acts (PIPA).
- **Québec Law 25** (amending the Act respecting the protection of personal
  information in the private sector, in force in stages 2022–2024): a named
  person in charge of personal information, privacy impact assessments,
  confidentiality incidents reported to the Commission d'accès à
  l'information, privacy by default, and a privacy impact assessment before
  personal information leaves **Québec** – which includes other Canadian
  provinces, so hosting in Canada does not by itself remove that step
  ([CAI – Law 25](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25)).
- **Charter of the French Language** (as amended by Bill 96, 2022):
  invoices, receipts and similar documents for Québec customers must be in
  French, and a French version must be at least as available as any other;
  product and website text offered in Québec must be available in French
  ([Legis Québec – C-11](https://www.legisquebec.gouv.qc.ca/en/document/cs/C-11)).
- **CASL** (anti-spam law) covers marketing e-mails: express or implied
  consent, sender identification and an unsubscribe link.
- Our DPA and privacy policy need a Canadian version (PIPEDA + Law 25);
  see `docs/expansion/legal*` once written by the legal workstream.

## Gaps (S = days, M = 1–2 weeks, L = more)

| Gap | Size |
|---|---|
| Customer province on the client record and place-of-supply logic choosing GST, HST or GST + PST/QST per invoice line | L |
| Two tax lines on one invoice (GST 5 % and QST 9.975 % / PST) in PDF, totals and exports | M |
| QST number field on the company and Québec registration flag | S |
| Invoice content tiers by amount (CAD 100 / 500) in the invoice checker; needs a two-threshold `when` in the contract | S |
| French (fr-CA) UI and French invoice template; bilingual invoice option for Québec | M |
| BN / GST/HST number validation in the UI, using the pack validators | S |
| Payment details: transit/institution/account and Interac e-Transfer e-mail on the invoice | S |
| GST/HST, PST and QST return summaries (net tax, ITCs) per period | M |
| Federal + provincial holidays and the PST/QST/T2 deadlines in the tax calendar | M |
| Canadian privacy policy, DPA, Law 25 privacy impact assessment and a named privacy officer | M |
| CASL-compliant marketing e-mail consent | S |
| Corporations Canada / provincial registry lookup (no free public API confirmed) | L |
| Cash rounding to CAD 0.05 for cash payments | S |
| Peppol / e-invoicing: nothing until a mandate is announced | – |

## Contract gaps found while building the pack

- `InvoiceRequirement.when` has one threshold; Canada needs two (CAD 100
  and CAD 500). The pack exports `caInvoiceFields(total)` meanwhile.
- No `payment_terms` value in `InvoiceField`.
- `TaxIdSpec` has no subdivision; the QST number is Québec-only and sits
  under `kind: 'other'`.
- `TaxRate` cannot say whether a subdivision rate replaces the federal one
  (HST) or is charged next to it (PST, QST); the pack says it in `appliesTo`.
- `holidays(year)` is national only; provincial holidays need
  `holidays(year, subdivision?)`.

## Open items (also in the pack's caveats)

- BN check digit is Luhn by common practice; CRA does not publish the scheme.
- QST check digit unknown; only the shape is validated.
- Start dates of the provincial rate sets other than NS's are from memory
  of the last rate changes and should be checked against provincial
  bulletins.
- Québec language rules and the 2024 regulation need a Québec lawyer.
- No e-invoicing mandate found; recheck yearly.
