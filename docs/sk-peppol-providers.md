# Slovak Peppol access point providers – shortlist for Billanta

Research date: **2026-10-19**. Companion to [sk-einvoicing-2027.md](sk-einvoicing-2027.md).

From 1.1.2027 Slovak VAT payers send domestic B2B invoices as Peppol BIS Billing 3.0
(Slovak CIUS) through a provider certified by Finančné riaditeľstvo SR ("digitálny
poštár"), and every Slovak business must be able to receive. Billanta already generates
the UBL, so what we need is a **transport partner**: an access point with an API that
lets one SaaS send and receive on behalf of many tenants, register each tenant as
`0245:<DIČ>`, and take care of the SK tax data document (TDD) reporting.

This document is a recommendation, not a decision. Nobody has been contacted; everything
below comes from public web pages. Each fact is tagged:

- **[V]** verified from a cited public source on the research date
- **[U]** unverified / inferred / not public – must be confirmed with the provider

## How the Slovak model affects the integration

Things learned along the way that shape any provider choice:

- **Tenants pick their provider on the FS SR portal themselves.** The taxpayer logs in to
  the Finančná správa portal (via slovensko.sk), selects a certified provider from the
  list at vpds.financnasprava.sk, the portal passes the taxpayer's identity to the
  provider, the provider verifies it, and only then registers the participant in Peppol
  **[V]** (podnikajte.sk, ecosio guide). eConnect's write-up states that a provider may
  not register a Slovak end user in the SMP without this FS SR mandate **[V]**. So
  Billanta cannot silently register `0245:<DIČ>` for a tenant; the onboarding flow needs
  a "go to the FS portal and choose provider X" step done by the tenant (or its
  authorised representative).
- **The vpds list covers "providers and their intermediaries"** ("sprostredkovatelia")
  **[V]**. Whether Billanta could or should appear there as an intermediary of its
  provider is an open question **[U]**.
- **TDD reporting is the provider's job.** Both the seller's and the buyer's access
  point submit a TDD to FS SR, within roughly 15 minutes of the exchange; MLS status
  receipts are due within 10 minutes **[V]** (ecosio guide). Billanta does not need to
  build TDDs itself if the provider does it.
- **SAPI-SK** is a voluntary, standardised REST interface between access points and
  accounting software, prepared by FS SR with industry (announced Feb 2026) **[V]**.
  ePošťák and Flowis say they implement it, EDITEL is finalising it **[V]**. Building
  Billanta's adapter against SAPI-SK is the cheapest insurance against lock-in.
- **Storecove**, a common default for SaaS Peppol integrations, is **not** on the FS SR
  certified list dated 2026-10-16 **[V]**, and its public docs do not list Slovakia
  **[V]**. It is therefore excluded for now.

## Selection criteria

In priority order:

1. On the FS SR certified list (hard requirement).
2. API that accepts our own UBL (not only their JSON or their UI), with public docs.
3. Multi-tenant / partner model: one integration, many tenants, per-tenant scoping.
4. Tenant onboarding via API, compatible with the FS SR portal selection step.
5. Webhooks (or a reliable pull queue) for inbound documents and delivery/MLS status.
6. TDD reporting done by the provider.
7. Free sandbox on the Peppol test network.
8. Transparent pricing that works for small tenants (many tenants send a handful of
   invoices a month).
9. EU hosting; company stability; CZ presence or ISDOC know-how is a bonus.

## FS SR certified list (as of 2026-10-16)

The PDF lists **80 providers, EFSK000001 – EFSK000080** **[V]**. Entries relevant here:

| EFSK ID | Provider | Country |
|---|---|---|
| EFSK000001 | Editel S.A (EDITEL) | PL |
| EFSK000006 | STORMWARE s.r.o. (POHODA) | CZ |
| EFSK000008 | Flowis, s.r.o. | SK |
| EFSK000010 | Asseco Solutions, a.s. | SK |
| EFSK000011 | SOFTIP, a. s. | SK |
| EFSK000012 | Kaja Solutions s. r. o. (ePošťák) | SK |
| EFSK000019 | Pagero AB (Thomson Reuters) | SE |
| EFSK000022 | Billit | BE |
| EFSK000023 | Qvalia AB | SE |
| EFSK000034 | eConnect International B.V. | NL |
| EFSK000036 | Comarch S.A. | PL |
| EFSK000042 | Dativery s.r.o. | CZ |
| EFSK000047 | ecosio InterCom GmbH | DE |
| EFSK000053 | Seyfor Slovensko, a.s. | SK |
| EFSK000061 | INPOSIA Solutions GmbH (website listed: avalara.com) | DE |
| EFSK000063 | Unimaze ehf., organizačná zložka | SK |
| EFSK000075 | Tickstar AB | SE |
| EFSK000076 | Basware Oy | FI |

Not on the list: Storecove, Sovos, B2Brouter, Banqup/Unifiedpost under that name, Ditec,
KROS **[V – absence on the 2026-10-16 PDF]**. The list says it is updated continuously.

## Comparison

Legend: ✓ public evidence, ~ partial / claimed, ? not public, ✗ not offered.

| | ePošťák (Kaja Solutions) | eConnect | Qvalia | Flowis | Tickstar | ecosio | EDITEL | Dativery / Peppos |
|---|---|---|---|---|---|---|---|---|
| EFSK ID | 000012 | 000034 | 000023 | 000008 | 000075 | 000047 | 000001 | 000042 |
| HQ | SK | NL | SE | SK | SE (Xero-owned) | AT/DE | PL/AT | CZ |
| REST API, public docs | ✓ OpenAPI, SDKs | ✓ OpenAPI | ✓ Partner API docs | ✓ Swagger on test host | ✓ SwaggerHub | ? | ~ SAPI, docs at onboarding | ? |
| Send own UBL as-is | ✓ (SAPI payload) | ? likely | ? | ✓ BIS3 XML | ✓ | ~ via conversion hub | ✓ | ? |
| SAPI-SK | ✓ | ? | ? | ✓ (claimed) | ? | ? | ~ in progress | ? |
| Multi-tenant partner model | ✓ partner key + consent per firm | ✓ white-label partner | ✓ multi-tenant Partner API | ~ multi-client accounts | ~ sub-org header | ? | ? | ? |
| Tenant onboarding via API | ✓ invitations/consent, `awaitingPfs` status | ? | ✓ (claimed) | ? | ✓ SMP API | ? | ? | ? |
| Webhooks inbound + status | ✓ status; inbound via pull or Enterprise webhooks | ✓ both | ? | ? | ? | ? | ? | ? |
| SK TDD by provider | ✓ | ✓ (module described) | ? not stated | ✓ (claimed) | ? | ✓ | ? | ? |
| Sandbox | ✓ free, on request | ✓ on request | ✓ | ✓ after NDA | ✓ test host | ? | ✓ | ? |
| Pricing public | ✓ per document | ✗ contract | ~ app plans only | ~ partly | ✗ | ✗ | ✗ | ? |
| Hosting | ? | ? | ? | EU (claimed) | AWS Ireland | ? | ? | ? |
| CZ presence | ? | ✗ | ✗ | ✗ | ✗ | ? | ~ (unverified) | ✓ |

## Candidates

### 1. ePošťák – Kaja Solutions s. r. o. (EFSK000012, SK)

- Certified **[V]**. Slovak company, product built specifically for the Slovak mandate.
- API: REST/JSON with public docs at epostak.sk/api/docs, OpenAPI specs and SDKs in six
  languages (npm `@epostak/sdk`) **[V]**. Three surfaces: SAPI (pure transport – we post
  finished BIS 3.0 XML in `payload`), Enterprise API, and a Connector for mapping
  **[V]**. OAuth2 client credentials, short-lived tokens, mandatory `Idempotency-Key`,
  202 on accept (not delivery) **[V]**. Rate limits about 150 sends / 200 reads per
  minute per key **[V]** – fine for us, but worth watching at month end.
- Multi-tenant: explicit models for a **technical partner** (free partner contract, one
  `sk_int_*` key for all firms that consented, each firm orders and pays itself) and a
  **managed integrator** (one contract, one invoice for all firms) **[V]**. Firms are
  selected per call with `X-Peppol-Participant-Id: 0245:<DIČ>` / `X-Firm-Id` **[V]**.
- Onboarding: API creates a consent offer or onboarding request for an IČO/DIČ and
  returns a one-time link; the firm's owner confirms; status `awaitingPfs` tracks the
  pending FS SR portal selection **[V]**. This maps directly onto the Slovak flow.
  Production activation of the partner is a manual approval after Kaja Solutions
  verifies the partner company **[V]**. Exact per-tenant SMP registration mechanics are
  not fully described **[U]**.
- Webhooks: `document.sent / delivered / delivery_failed / mls_received / rejected`
  plus `onboarding.*` and `consent.*` **[V]**. One global webhook per integrator, events
  carry the firm reference **[V]**. Inbound documents via pull (`/document/receive` +
  acknowledge) or Enterprise webhook subscriptions **[V]**. Webhook signature scheme not
  documented on the pages read **[U]**.
- TDD: handled by ePošťák, including the case where the recipient is not on Peppol and a
  later resubmit **[V]**.
- Sandbox: free, separate host (dev.epostak.sk), two test companies on the test Peppol
  network, set up manually on email request **[V]**.
- Pricing: public, pay per document, no subscription or setup fee; sending about
  €0.10 down to €0.04 and receiving about €0.08 down to €0.04 depending on monthly
  volume **[V]**. Mailbox product for end users has a free receiving tier **[V]**.
  Partner (white-label) pricing on request **[V]**.
- Hosting / sub-processors / SLA: not found on the pages read **[U]**.
- Risks: small company; SDK repository lives under a personal GitHub account, which
  hints at a small team **[U – inference]**. Needs a due-diligence call on SLA,
  support, and continuity.

### 2. eConnect International B.V. (EFSK000034, NL)

- Moved to the FS SR certified list on 28.5.2026; passed the OpenPeppol SK test suites in
  April 2026 **[V]**. Their own SK page also mentions extra internal steps before live
  Slovak B2B traffic, which conflicts with a "production-live" claim on the same page
  **[V – conflict noted]**.
- API: REST, OAuth2, public OpenAPI/Swagger, PHP and .NET SDKs **[V]**.
- Partner model built for software vendors: no own access point needed, optional
  white-label with own domain and branding **[V]**. Typical partner go-live about four
  weeks **[V]**.
- Webhooks push both inbound documents and status updates; SFTP and polling as
  alternatives **[V]**. MLS statuses come through the same channels **[V]**.
- TDD: generated automatically by their PSB module alongside each exchange **[V]**.
- Sandbox / acceptance environment available on request **[V]**.
- Participant registration via API, KYC, hosting location: not described **[U]**.
- Pricing: partner contract, not public **[V]**. No CZ/SK presence found.

### 3. Qvalia AB (EFSK000023, SE)

- Certified since May 2026 **[V]**.
- Three partner options: embedded Peppol through one API (we own the UI), white-label of
  their app, or a hosted access point under our own identity (requires ISO 27001)
  **[V]**. Partner API supports multi-tenant management with a separate tenant and
  Peppol ID per end customer; Qvalia handles registration and directory updates **[V]**.
  Public Partner API reference at api.qvalia.io **[V]**. Sandbox offered **[V]**.
- Slovak TDD handling is not described on their SK pages **[U]** (certification
  implies they do it, but confirm). Webhooks: not confirmed **[U]**.
- Pricing: app plans are public (small monthly fees), partner pricing is not **[V]**.
- No CZ/SK presence found.

### 4. Flowis, s.r.o. (EFSK000008, SK)

- Certified **[V]**. Bratislava company **[V]**.
- REST API with Swagger docs on a test host, SAPI SK compatibility announced for
  May 2026 **[V]**. Test access after email + NDA, with API token and test Peppol IDs
  within one working day **[V]**.
- Offers a white-label variant for large ERP systems and multi-client accounts for
  accounting firms **[V – via Slovensko.Digital overview and own site]**.
- Says it reports the required data to FS SR automatically **[V]**. Claims ISO 27001,
  SOC 2 Type 2 and EU processing **[V – self-reported]**.
- Multi-tenant API onboarding, webhooks: not described **[U]**. Paid plans "coming
  soon", API/partner pricing not public **[V]**.

### 5. Tickstar AB (EFSK000075, SE, owned by Xero)

- Certified **[V]**. Long-standing Peppol infrastructure provider used by large
  accounting platforms (Xero acquired it in 2021) **[V – secondary]**.
- REST Transaction API, Participant Lookup API and an SMP Manager API to create and
  activate participants from our own application; specs on SwaggerHub **[V]**.
  Sub-organisation header suggests per-customer separation **[V]**. Test hosts exist
  **[V]**. SMP API is a separately priced add-on **[V]**. Hosted on AWS with an EU region
  in Ireland **[V]**.
- Nothing public on Slovak TDD handling or how the FS SR mandate step fits their SMP
  flow **[U]**. Pricing not public. More of a wholesale/infrastructure partner: strong
  if we want low per-message cost at scale, heavier to integrate.

### 6. ecosio InterCom GmbH (EFSK000047, DE/AT)

- Certified **[V]**. Strong Slovak compliance material; explicitly builds and submits the
  SK TDD, handles MLS, retries and 10-year archiving **[V]**.
- Primarily an EDI/integration hub for ERP customers; API exists for ERP integration and
  status, but no public reference or ISV/multi-tenant partner terms were found **[U]**.
  Pricing not public. Better fit for enterprise customers than for a small-tenant SaaS.

### 7. EDITEL (EFSK000001, PL entity; group active in CZ/SK)

- Certified **[V]**. Took part in the SAPI-SK working group and is finalising a native
  SAPI implementation on its eXite platform; dedicated test environment during
  onboarding **[V]**.
- Group operates in the Czech Republic as well **[U – not checked in detail]**.
- No public ISV/multi-tenant terms, pricing, or webhook details **[U]**. Worth a call
  mainly because of SAPI and regional presence.

### 8. Dativery s.r.o. / Peppos (EFSK000042, CZ)

- Certified **[V]**. Czech integration platform for POHODA, ABRA Flexi and Money S3
  users; runs Peppol e-invoicing under the Peppos brand **[V]**.
- Developer section and partner page exist, but no API, webhook, sandbox or pricing
  details could be read **[U]**. Interesting as a CZ-based partner who also knows ISDOC
  and Czech accounting software; needs a direct look at peppos.cz.

### Considered, not shortlisted

- **Storecove** – best-documented SaaS Peppol API in general, but **not certified in SK**
  as of 2026-10-16 **[V]**. Re-check later; if it gets certified it becomes a strong
  option.
- **Pagero / Thomson Reuters** (EFSK000019), **Basware** (EFSK000076), **Comarch**
  (EFSK000036), **Avalara via INPOSIA** (EFSK000061) – certified, but enterprise-oriented
  and nothing public about SK-specific APIs or small-tenant pricing **[U]**.
- **SOFTIP** (EFSK000011) and **MRP** (EFSK000002) – Slovak providers advertising a
  multitenant API / REST API for external ERPs **[V – Slovensko.Digital overview]**, but
  they are also accounting software vendors, i.e. potential competitors. **Seyfor**
  (EFSK000053) and **STORMWARE** (EFSK000006) likewise.
- **Billit** (EFSK000022), **Unimaze** (EFSK000063), **Routty** (EFSK000055) – certified
  and have APIs, but no public multi-tenant SK details found.

## Recommendation

**Primary: ePošťák (Kaja Solutions).** It is the only candidate where every critical
requirement is visible in public docs today: SAPI-SK transport that accepts our own UBL,
an explicit partner/integrator model with per-firm consent, an onboarding API that
already models the FS SR portal step (`awaitingPfs`), status and MLS webhooks, TDD
handled including the "recipient not on Peppol" edge case, a free sandbox, and public
per-document pricing with no fixed fee – which suits tenants who send few invoices. It
is Slovak, so support and legal context align with the mandate.

**Fallback: eConnect.** Mature partner-oriented REST API with public OpenAPI, webhooks for
both inbound documents and statuses, white-label option, and documented automatic TDD
generation. It hedges the main risk of the primary (a small company) with a different,
larger network. **Qvalia** is a close alternative fallback because its Partner API is
explicitly multi-tenant; pick between the two after one call each.

**Architecture regardless of choice:** put all transport behind one backend interface
(send, poll/receive, acknowledge, status, onboarding) modelled on SAPI-SK. ePošťák's SAPI
is the first implementation; a second provider then becomes an adapter, not a rewrite.
Keep UBL generation, validation and archiving in Billanta so the provider only moves
bytes and reports TDD.

## Open questions for providers

1. Exact tenant onboarding: what the tenant must do on the FS SR portal, what we can do
   by API, how long verification takes, and what happens when a tenant already has
   another provider (send-only mode vs moving receiving).
2. Can Billanta be listed as your "sprostredkovateľ" on vpds, and does that change the
   tenant flow?
3. Contract model: technical partner (each tenant contracts and pays you) vs managed
   integrator (Billanta pays one invoice). Partner pricing, minimums, volume tiers.
4. Inbound per tenant: webhook payload, signature/verification scheme, retry policy,
   ordering, and how long undelivered documents are kept.
5. TDD: confirm you submit both outbound and inbound TDDs, how corrections/resubmits and
   FS SR errors are surfaced to us, and who is liable for late reporting.
6. Do you accept our BIS 3.0 XML unchanged (Slovak CIUS validated on your side), and
   which validation errors come back synchronously?
7. Credit notes, self-billing, attachments (size limits), and non-Peppol fallback
   delivery.
8. Hosting location, sub-processors, SLA/uptime, support hours, DPA, exit terms
   (export of documents and participant migration to another provider).
9. Sandbox access for a SaaS with many test tenants; cost of SMP registrations in test.
10. Roadmap for SAPI-SK compliance and version.

## Decisions for the user

- Approve contacting ePošťák and eConnect (and optionally Qvalia) for partner terms.
- Choose the commercial model: tenants pay the provider directly vs Billanta resells and
  includes Peppol in its plans.
- Decide whether Billanta should pursue intermediary status on vpds.
- Decide how much onboarding guidance to build in-app for the FS SR portal step (cs/sk/en).

## Sources

All accessed 2026-10-19.

- FS SR certified provider list (2026-10-16): https://www.financnasprava.sk/_img/pfsedit/Dokumenty_PFS/Podnikatelia/Dan_z_pridanej_hodnoty/efaktura/2026/2026.10.16_zoznam_cert.pdf
- FS SR provider selection (vpds): https://vpds.financnasprava.sk/
- Podnikajte.sk, digital postman process: https://www.podnikajte.sk/zakonne-povinnosti-podnikatela/e-faktura-co-vediet-o-digitalnych-postaroch
- SITA, SAPI-SK announcement (2026-02-19): https://sita.sk/vofinanciach/slovensko-chce-zjednotit-elektronicke-faktury-stat-ocakava-znizenie-nakladov-a-vacsiu-transparentnost/
- Slovensko.Digital, e-invoice support overview (Sep 2026): https://slovensko.digital/wp-content/uploads/2026/09/prehlad-podpory-e-faktur-u-clenov.pdf
- VATupdate, directory launch: https://www.vatupdate.com/2026/06/14/over-130-businesses-choose-a-digital-postman-in-first-week-of-efaktura-directory/
- ePošťák: https://www.epostak.sk , https://www.epostak.sk/api , https://www.epostak.sk/api/docs , https://www.epostak.sk/api/docs/onboarding , https://www.epostak.sk/api/docs/connector
- eConnect SK regulation page: https://econnect.eu/en/docs/knowledge/regulations/europe/slovakia
- eConnect software partners: https://econnect.eu/en/partners/software-partners
- Qvalia SK certification: https://qvalia.com/qvalia-certified-for-slovakia-e-invoicing-under-the-efaktura-framework/
- Qvalia SK page: https://qvalia.com/slovakia-e-invoicing-efaktura-digital-postman-peppol-solutions/
- Qvalia partners: https://qvalia.com/become-a-partner/
- Flowis: https://postarflowis.sk/ , https://postarflowis.sk/api-integracie/ , https://postarflowis.sk/cennik/
- Tickstar: https://www.tickstar.com/ , https://www.tickstar.com/?p=3152 , https://www.tickstar.com/article/smp-manager-api-v-2/
- ecosio SK: https://ecosio.com/en/compliance/slovakia/e-invoicing/ , https://ecosio.com/en/blog/e-invoicing-in-slovakia-compliance-guide/
- EDITEL SAPI: https://www.editelgroup.com/sapi-rest-api-for-next-generation-e-invoicing/
- Dativery: https://www.dativery.com
- Storecove docs: https://www.storecove.com/docs/
