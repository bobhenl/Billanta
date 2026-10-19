# Slovak mandatory e-invoicing (eFaktúra) from 2027

Status: research and gap plan. Facts checked against official sources on
**19 October 2026**. Nothing here is legal advice; the binding text is the
VAT Act as amended.

## TL;DR and how this differs from what we assumed

We assumed: "Slovakia makes domestic B2B e-invoicing with reporting
mandatory from 2027." That is **mostly right**, with four corrections:

| Assumption | What the law says |
|---|---|
| All businesses must e-invoice from 2027 | Only **VAT payers** (§ 4, 4b, 4c) must *issue* e-invoices for domestic supplies. But **every** business and legal person, non-payers included, must be able to **receive** them from 1.1.2027. |
| Reporting is a separate thing we send to the tax office | Reporting rides on the e-invoice: the supplier's certified provider ("digitálny poštár") reports the data to Finančné riaditeľstvo SR when the invoice is sent. The buyer's provider reports within 5 days of receipt. No separate portal upload. |
| It is a central government platform | It is the **Peppol** network (5-corner model). The state certifies providers and receives the reports, it does not route invoices. |
| 2027 is the full reform | 2027 is a **transitional** domestic phase (§ 85o). The full ViDA regime, including cross-border supplies, a 10-day deadline and the end of the kontrolný and súhrnný výkaz, starts **1.7.2030**. |

Also: a further amendment (parliamentary print 1454, see "Uncertain") is
pending and would soften the start. It is **not law** yet.

## Law

- **Zákon č. 222/2004 Z. z. o dani z pridanej hodnoty** (ZoDPH), as amended
  by **zákon č. 385/2025 Z. z.** (transposes Council Directive (EU)
  2025/516, "ViDA").
- Transitional rules for 1.1.2027 – 30.6.2030: **§ 85o** (scope, deadlines,
  reporting, archiving, the voluntary 2026 phase in ods. 21–22).
- Delivery service and certified providers: **§ 76a**.
- Duty to be able to receive: **§ 71 ods. 5**.
- From 1.7.2030: new **§ 71 ods. 1 b)** (e-invoice is the default), **§ 73**
  (10-day deadline), **§ 74 ods. 1 p), q)** (new mandatory fields), **§ 80**
  (digital reporting of cross-border supplies, replaces the súhrnný výkaz).
- Penalties for the reporting duty: up to **€10,000**, repeated breach up to
  **€100,000** (FR SR guidance 1/DPH/2026/I, chapter on oznamovacia
  povinnosť; FAQ example 18).

## Dates and phases

| When | What |
|---|---|
| 1.1.2026 – 31.12.2026 | **Voluntary phase.** Anyone may send e-invoices through a certified provider if the buyer has one too (§ 85o ods. 21–22, FAQ example 15). |
| **1.1.2027** | **Mandatory domestic phase.** Applies to supplies made (and advance payments received) from this day on. 15-day issuing deadline (§ 85o ods. 6). Everyone in scope must be able to receive. |
| 1.7.2030 | **ViDA.** E-invoicing becomes the default incl. intra-EU B2B supplies, deadline 10 days, kontrolný výkaz and súhrnný výkaz abolished (FAQ example 9), cross-border digital reporting under § 80. |

## Scope (2027 – 2030)

**Must issue an e-invoice:** a Slovak VAT payer (§ 4, 4b, 4c) for a supply
of goods (§ 13) or services (§ 15, 16) with place of supply in Slovakia to:

- a domestic taxable person (business, self-employed, VAT payer or not), or
- a domestic non-taxable legal person (e.g. an association, a municipality
  acting outside business).

Covers invoices, advance-payment invoices for payments received (UBL type
code **388**, FAQ example 38), credit notes and debit notes. A **proforma is
not a tax document** and stays outside (FAQ example 34).

**Must be able to receive:** every legal person and every taxable person
(including non-payers, freelancers, landlords) from 1.1.2027 (FAQ example 7,
§ 71 ods. 5). In practice: a contract with a certified provider.

**Outside the mandate (may still be sent voluntarily):**

- B2C (private individuals);
- supplies exempt under § 28–43 and § 47;
- supplies already documented by an **eKasa** receipt up to **€400**, and
  simplified invoices up to **€100**;
- supplies inside a VAT group;
- classified supplies / supplies to SIS and military intelligence, where an
  e-invoice must **not** be used (FAQ example 8);
- cross-border supplies (until 1.7.2030).

The buyer's **consent is not required** when the e-invoice is mandatory
(FAQ example 12).

## Format

- **EN 16931** in **UBL 2.1**, profile **Peppol BIS Billing 3.0** with the
  Slovak national rules (FR SR "Peppol BIS 3 transposition" spreadsheet,
  version 1.12 of 14.10.2026). CII is allowed by the directive, but the
  Slovak Peppol rules are written for UBL.
- **Peppol participant ID: `0245:<DIČ>`** (10-digit DIČ without the SK
  prefix), not `9950:SK…` (FAQ example 23). The IČ DPH goes into
  `PartyTaxScheme/CompanyID`; the endpoint is not compared with it.
- **Corrections:** a **credit note (381)** plus a new invoice. The
  "corrected invoice" type 384 is **not** allowed yet (FAQ example 30). A
  credit note must reference the original invoice in **BT-25**
  (`BillingReference/InvoiceDocumentReference`). A debit note (383) with
  BT-25 is allowed.
- VAT category O (outside scope) must not carry a VAT ID (BR-O-02); the FAQ
  section III maps Slovak VAT situations to category codes and VATEX.
- PDF by email stops being a valid tax document for in-scope supplies.

## Transmission and reporting model

- **5-corner Peppol model**: supplier → supplier's provider (access point)
  → buyer's provider → buyer, and both providers report to the tax
  administration (the 5th corner, "TDD").
- Providers must be **certified by FR SR** (the Slovak Peppol Authority,
  FAQ example 20). The list of 16.10.2026 has **80 certified providers**
  (EFSK000001 – EFSK000080), SK, CZ and international. Lookup:
  https://vpds.financnasprava.sk/
- **Supplier reporting:** at the time the e-invoice is issued (or on the
  last day of the deadline if it was not issued). **Buyer reporting:**
  within **5 days** of receipt. Both done by the provider automatically.
- **Archiving:** 10 years (§ 85o ods. 15).
- **Cost (FR SR's own estimate, FAQ example 10):** pay-per-use or a
  subscription; a simple provider app should cost about **€5 – 12 per
  month**. Exact prices are per provider.

## Penalties

- Not reporting, reporting late, incomplete or wrong data: up to **€10,000**;
  repeated: up to **€100,000**. The tax office weighs severity and duration.
- No fine for an obvious mistake corrected promptly, or for a proven
  technical failure on the provider's side if the data is reported right
  after it is fixed.

## Uncertain / to watch

1. **Parliamentary print 1454** (NR SR, 9th term):
   https://www.nrsr.sk/web/Default.aspx?sid=zakony/zakon&ZakZborID=13&CisObdobia=9&CPT=1454
   proposes a tolerance period 1.1. – 30.6.2027 and dropping the buyer's
   reporting duty. As of 19.10.2026 it is **not adopted**. The public page
   mentions it only as "proposed". Re-check before 1.1.2027.
2. The **Slovak BIS 3.0 rules** are versioned (v1.12 now); expect changes
   before go-live. Our generator follows EN 16931 + Peppol BIS 3.0 core and
   the Slovak points we could verify (0245, BT-25, 381/388), but we have
   **not run the official schematron** (no offline validator in the repo).
3. Exact handling of **advance-payment tax documents** in mixed cases and
   of **self-billing** is described only in FAQ examples, not in the Act.
4. Whether a **non-payer** who only receives needs a full provider contract
   or a free "mailbox" tier depends on the market; several providers
   announce free receiving, not verified by us.

## Sources (accessed 19.10.2026)

- FR SR, guidance **1/DPH/2026/I** on Act 385/2025 Z. z.:
  https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Zverejnovanie_dok/Dane/Novinky_leg/Nepriame_dane/2026/2026.01.14_001_DPH_2026_I.pdf
- FR SR, **FAQ eFaktúra 9/DPH/2025/IM**, version of 12.10.2026:
  https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Podnikatelia/Dan_z_pridanej_hodnoty/efaktura/2026/2026.10.12_FAQ_eFaktura.pdf
- FR SR, manual for taxable and non-taxable persons, 26.8.2026:
  https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Podnikatelia/Dan_z_pridanej_hodnoty/efaktura/2026/2026.08.26_manual_efakturacia.pdf
- FR SR, implementation timeline, 18.3.2026:
  https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Podnikatelia/Dan_z_pridanej_hodnoty/efaktura/2026/2026.03.18_eFak_harmonogram.pdf
- FR SR, list of certified providers, 16.10.2026:
  https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Podnikatelia/Dan_z_pridanej_hodnoty/efaktura/2026/2026.10.16_zoznam_cert.pdf
- FR SR, Peppol BIS 3 Slovak transposition v1.12, 14.10.2026:
  https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Podnikatelia/Dan_z_pridanej_hodnoty/efaktura/2026/2026.10.14_Peppol_Bis3_v1_12.xlsx
- FR SR, eFaktúra landing page:
  https://www.financnasprava.sk/sk/podnikatelia/dane/dan-z-pridanej-hodnoty/e-faktura
- Act 222/2004 Z. z., consolidated as of 1.1.2027 (Slov-Lex):
  https://www.slov-lex.sk/ezbierky-fe/pravne-predpisy/SK/ZZ/2004/222/?ucinnost=01.01.2027
- NR SR, print 1454 (pending amendment): link above.

## What Billanta does today (true claims only)

- Generates **UBL 2.1 / Peppol BIS Billing 3.0** XML for issued invoices
  **and credit notes** (`packages/cz-compliance/src/ubl-generator.ts`,
  download `/api/files/invoices/:id/ubl`).
  - Slovak parties get the Peppol ID **0245:DIČ**; the IČ DPH goes into
    PartyTaxScheme only when the party is a VAT payer.
  - Credit notes are `CreditNote` type **381** with **BT-25** pointing at
    the corrected invoice (`related_invoice_id`), positive amounts,
    `CreditedQuantity`.
- Pre-flight **Peppol check** in the invoice detail (missing DIČ for the
  0245 address, missing BT-25 on a credit note, VAT IDs, addresses, IBAN).
- `skEInvoiceScope()` (`packages/cz-compliance/src/sk-einvoicing.ts`): tells
  whether a document must be an e-invoice; used by the public readiness
  check, ready for the dashboard.

**Not yet (marked "pripravujeme" on the public page):** sending and
receiving through a certified provider, delivery status, reporting
confirmation, inbox of received e-invoices.

## Gap plan

### 1. Peppol BIS 3.0 validation

- **Now:** our own pre-flight rules (`validatePeppolInvoice`) and unit tests
  for the generator.
- **Next (small):** add a CI test that validates generated samples with the
  official **Peppol BIS 3.0 + Slovak schematron** (XSLT 2 via Saxon-HE in a
  Docker step, or the provider's validation API). Fixtures: invoice SK→SK
  payer, SK→SK non-payer, credit note, reverse charge, 0% exempt with VATEX.
- **Later:** run the provider's validation on send and surface its errors
  with the same `peppol.code.*` messages.

### 2. Access point: choice and rough cost

Options:

| Option | Effort | Cost | Notes |
|---|---|---|---|
| **A. Integrate a certified provider's API** (recommended) | 2 – 4 weeks | per document or monthly per tenant; FR SR expects €5 – 12/month for a simple plan; wholesale API pricing to negotiate | Provider does Peppol, SMP registration, TDD reporting, archiving option. We need: send, receive webhook, status, participant lookup. |
| B. Become a certified provider ourselves | months | OpenPeppol membership, PKI certificates, FR SR certification, 24/7 operations, audits | Only worth it at large scale. Not recommended now. |
| C. Do nothing, users download UBL and upload to their own provider | none | user pays provider | What we have today. Fine as a fallback, weak as a growth hook. |

Shortlist criteria for A: REST API with webhooks, SK + CZ presence,
multi-tenant (one contract, many participants), receiving included, price
per tenant under our Pro margin, test environment. Candidates from the
certified list include SK and CZ software vendors and international
networks; we have not contacted any.

### 3. Receiving

- Every SK customer of ours must be able to receive from 1.1.2027, even
  non-payers. With option A: register each SK tenant as a participant
  (`0245:DIČ`) at the provider, receive via webhook, store the UBL, render a
  PDF view, and create an **expense draft** (`pending_review`, never booked
  automatically).
- Needs: `incoming_einvoices` table (tenant-scoped, RLS like `expenses`),
  dedupe on (sender ID, invoice number), mapping UBL → expense lines.

### 4. Reporting

- Done by the provider in the 5-corner model; we store the provider's
  status (`sent`, `delivered`, `reported`, `rejected` + reason) per invoice
  and show it in the detail and list.
- Buyer reporting (5 days) is also the provider's job on receive. If print
  1454 passes, it may disappear.

### 5. Data model changes

| Change | Why |
|---|---|
| Split `dic` into **DIČ** and **IČ DPH** for SK parties (tenants and contacts) | Today SK payers store the IČ DPH (`SK` + 10 digits) in `dic`, which is enough to derive `0245:DIČ`, but a non-payer only has the DIČ and the export validation expects `^SK\d{10}$`. Two fields avoid guessing. |
| Advance-payment **tax document** type (UBL 388) | Mandatory for payments received before supply from 2027. Today we have `proforma` (not a tax document) only. |
| `einvoice_status`, `einvoice_provider_id`, `einvoice_sent_at`, `einvoice_message_id` on invoices | Delivery and reporting status from the provider. |
| Per-tenant Peppol registration (participant ID, provider, registered at) | Receiving and sending. |
| 10-year archive of the sent/received XML | § 85o ods. 15; keep the exact XML that went out, not a regenerated one. |
| eKasa / simplified invoice flag | To exclude supplies already documented by eKasa (≤ €400) from the "must be e-invoice" check. |

### 6. Decisions for the user

1. **Provider:** integrate one certified provider (option A), which one,
   and who pays (included in Pro vs per-document add-on).
2. **Pricing:** is SK receiving free for all tenants (strong hook, costs us
   the provider fee) or part of a paid plan?
3. **Data model:** approve the DIČ / IČ DPH split and the advance-payment
   tax document type before we build sending.
4. **Timeline:** aim for sending + receiving in a pilot by **1.12.2026** so
   SK users can test before 1.1.2027.
5. **Wording:** the public page says sending is "being prepared". Change it
   only when the integration is live.
