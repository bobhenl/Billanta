# United States – expansion notes

Status: country pack `US` in `packages/cz-compliance/src/countries/us/`
(support level `pack`, data checked 2026-10-28). Nothing is wired into the
app yet.

## 1. How invoicing works in the US

- **There is no federal VAT and no federal invoice law.** An invoice is a
  commercial document. What has to be on it comes from state sales-tax rules
  (tax stated separately from the price) and from what the client's
  accounts-payable team needs before it pays.
- **Sales tax is a state and local tax.** 45 states and DC have a statewide
  sales tax. Alaska, Delaware, Montana, New Hampshire and Oregon do not,
  although Alaskan boroughs and some Montana resort towns charge local tax.
  On top of the state rate come county, city and district rates, so there
  are more than 10,000 taxing jurisdictions in total.
- **Taxability differs by state.** Most professional services (consulting,
  design, development) are not taxable in most states. SaaS, digital goods
  and some services (for example in Hawaii, New Mexico, South Dakota and
  Washington) are. A freelancer selling only services often charges no sales
  tax at all.
- **Nexus decides where you must collect.** Before 2018 you collected only
  where you had a physical presence. Since *South Dakota v. Wayfair* every
  sales-tax state also has an economic threshold. It is usually USD 100,000
  of sales into the state. AL and MS use USD 250,000, and CA, TX and NY use
  USD 500,000 (NY also needs more than 100 transactions). About half of the
  states have dropped the old "or 200 transactions" test: IL in 2026, KY from
  1 Aug 2026, UT in 2025, and IN, NC and WY in 2024. The full table is
  `US_ECONOMIC_NEXUS`.
- **B2B buyers who resell** give the seller a resale or exemption
  certificate (a state form or the multistate SST certificate). The seller
  then charges no tax and has to keep the certificate on file.
- **No e-invoicing mandate.** The DBNAlliance network, which grew out of the
  Business Payments Coalition, is a voluntary B2B exchange built on Peppol
  technology. Federal agencies take invoices through their own portals.
- **Payments:** ACH (routing + account number), cards, Zelle, paper checks
  (still common in B2B) and wires. There is no national payment QR code.
- **Year-end:** clients that paid a contractor at least USD 600 (USD 2,000
  for payments from 2026) send a Form 1099-NEC by 31 January. To do that
  they ask the freelancer for a Form W-9 (name, EIN or SSN). The freelancer
  pays estimated tax four times a year (15 Apr, 15 Jun, 15 Sep, 15 Jan).

## 2. What a US freelancer or small business expects from invoicing software

1. Fast invoices and estimates (quotes) with a clean PDF, sent by email
   with a "Pay now" link.
2. **Online payment on the invoice**: card and ACH through Stripe or
   similar, sometimes PayPal or Venmo. Getting paid is the main reason people
   pay for invoicing software.
3. Automatic payment reminders, late fees and recurring invoices, plus
   retainers and deposits.
4. Time and expense tracking that turns into invoice lines (agencies,
   consultants).
5. Sales tax done for them, or at least one tax rate per customer and per
   item, and a sales-tax liability report.
6. A client portal, and the W-9 and 1099 workflow.
7. Bank feeds and a profit-and-loss view for Schedule C, plus an export to
   or sync with QuickBooks for their accountant.
8. A mobile app, US formats (MM/DD/YYYY, USD, letter paper) and ZIP codes
   with state.

## 3. Competitors (our own summary)

| Product | Positioning | What it does well | Where Billanta can differ |
|---|---|---|---|
| **QuickBooks Online** (Intuit) | The default accounting system for US small businesses and their accountants | Full ledger, bank feeds, payroll, automatic sales tax, accountant network | Heavy and expensive for a solo freelancer; prices keep rising. A lighter "invoice first" tool with a QuickBooks export is a common pairing. |
| **FreshBooks** | Invoicing and time tracking for service businesses | Polished invoices, time tracking, client experience | Paid plans with client limits; the CZ/SK depth does not matter in the US, so price, AI drafts and a simpler UI have to carry it. |
| **Wave** | Free invoicing and accounting for micro businesses | Free core, payments and payroll as paid add-ons | Free is hard to beat on price. Compete on voice/AI drafting, multi-country support (EU clients) and support quality. |
| **Invoice Ninja** | Open-source invoicing, self-hosted or hosted | Many gateways, client portal, low price, self-hosting | Strong with technical users; Billanta can win on UX, AI and compliance content. |

Others worth watching are Zoho Invoice (free, part of the Zoho suite),
Bonsai and HoneyBook (freelancer CRM plus contracts), and Square and
Stripe Invoicing (payments first).

**Where Billanta fits:** freelancers and small firms that bill clients in
both the EU and the US (CZ/SK founders with US clients, US contractors with
EU clients), plus voice or AI drafts. Competing head-on for purely domestic
US accounting is not the goal.

## 4. Sales-tax strategy

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A. Manual rate** (MVP) | The user enters the combined rate per customer or ship-to location, with the state rate from the pack as the default | No vendor, no cost, enough for service businesses that rarely charge tax | The user is responsible; a mistake is easy; no filing |
| **B. Stripe Tax** | A rate API keyed on address and product tax code, billed per transaction | Fits if we already use Stripe for "Pay now"; covers US, EU VAT and more | Cost per call; ties tax to Stripe; filing through partners |
| **C. TaxJar** (Stripe-owned) | Rate API, nexus insights, AutoFile | Developer-friendly, nexus reports | Overlaps with Stripe Tax; future direction unclear |
| **D. Avalara AvaTax** | Enterprise rate engine, exemption-certificate management, filing | Most complete, accountants know it | Expensive, heavy onboarding, too much for the core segment |

**Recommendation:** launch with **A**: the state rate as the default plus
an editable combined rate, a clear "local tax not included" hint, an
exemption flag per customer with a place to store the resale certificate,
and the nexus table as a "you may need to register in X" warning built from
the user's own sales by state. Add **B (Stripe Tax)** as an optional
integration behind a `TaxRateProvider` interface once Stripe payments are
live. Keep Avalara for later, if larger customers ask for it.

## 5. Gap list

| # | Gap | Size |
|---|---|---|
| 1 | US address model: state (subdivision), ZIP / ZIP+4, no IČO/DIČ fields; ship-to address separate from bill-to | M |
| 2 | Sales tax per line or customer with an editable combined rate and an exempt flag; tax shown separately on the PDF | M |
| 3 | Store resale / exemption certificates per customer (file + expiry) | S |
| 4 | Nexus warning: sales and transactions per state for the period vs. `US_ECONOMIC_NEXUS` | S |
| 5 | `TaxRateProvider` interface + Stripe Tax integration (address validation, product tax codes) | L |
| 6 | Card and ACH "Pay now" link on the invoice (Stripe), payout reconciliation | L |
| 7 | US PDF template: letter paper, MM/DD/YYYY, "Bill to / Ship to", "Remit to", payment terms (Net 30) | S |
| 8 | Estimates/quotes, deposits, retainers and late fees | M |
| 9 | W-9 collection and a 1099-NEC report of payments per contractor (for users who pay contractors) | M |
| 10 | QuickBooks Online export / sync (CSV first, API later) | M |
| 11 | Per-tenant time zone (the US spans six); the pack default is only `America/New_York` | S |
| 12 | `en-US` locale details (spelling, date and number formats) separate from the current `en` | S |
| 13 | Sales-tax liability report per state and period for filing | M |
| 14 | DBNAlliance/Peppol exchange for US B2B, only if a customer asks – the UBL generator is the base | L |
| 15 | Legal: US terms, privacy (CCPA/CPRA), sales-tax disclaimer, and whether Billanta itself owes sales tax on SaaS in states that tax it | M |

## 6. Contract gaps found while building the pack

- **No per-subdivision tax IDs.** State sales-tax permit numbers have one
  format per state; `taxIds` is country-wide.
- **No place for nexus or registration thresholds per subdivision.**
  `registrationThreshold` takes a single amount, so the table is a separate
  export (`US_ECONOMIC_NEXUS`).
- **No representation of local rates** or of "combined rate = state + local".
  `TaxRateSet.subdivision` covers the state level only.
- **No product taxability** (product tax codes, exempt categories by state).
- **No voluntary e-invoicing networks.** `einvoicing` lists only mandates, so
  DBNAlliance lives in a comment and the caveats.
- **No customer-side exemption** (resale certificate) in `InvoiceRules`.
- **`holidays()` has no federal/state split** and does not say whether it
  returns actual or observed dates. The US pack returns observed dates.
- **`TaxIdSpec` has no "sensitive" flag** to stop SSN/ITIN being logged or
  printed.

## Sources

- South Dakota v. Wayfair, 585 U.S. 162 (2018) – https://www.supremecourt.gov/opinions/17pdf/17-494_j4el.pdf
- Streamlined Sales Tax Governing Board – https://www.streamlinedsalestax.org/
- IRS, valid EIN prefixes – https://www.irs.gov/businesses/small-businesses-self-employed/how-eins-are-assigned-and-valid-ein-prefixes
- IRS, estimated taxes – https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes
- IRS, Instructions for Forms 1099-MISC and 1099-NEC – https://www.irs.gov/instructions/i1099mec
- OPM, federal holidays – https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/
- DBNAlliance – https://dbnalliance.org/
- Avalara, Kentucky removes its transaction threshold (April 2026) – https://www.avalara.com/blog/en/north-america/2026/04/kentucky-removes-transaction-threshold-taxes-data-brokering-services.html
- TaxCloud, sales tax changes 2026 – https://taxcloud.com/blog/sales-tax-changes-2026/
- NexusFlag, economic nexus thresholds by state – https://nexusflag.com/guide/economic-nexus-thresholds-by-state
- Sovos / Sales Tax Institute, DC rate rise postponed to 2027-10-01 – https://sovos.com/regulatory-updates/sut/district-of-columbia-delays-sales-tax-increase-to-october-1-2027/
