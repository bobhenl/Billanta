# Nordics and Baltics – market and compliance summary

Country packs: `packages/cz-compliance/src/countries/{se,dk,fi,ee,lv,lt}`.
All six are at `supportLevel: 'pack'` (researched, not wired into the app).
Data checked on 2026-10-28. Each pack lists its open questions in `caveats`
and its sources in `sources`; this page is the short version.

## At a glance

| | SE | DK | FI | EE | LV | LT |
|---|---|---|---|---|---|---|
| Currency | SEK | DKK | EUR | EUR | EUR | EUR |
| Standard VAT | 25 % | 25 % | 25.5 % | 24 % | 21 % | 21 % |
| Reduced | 12, 6 | – | 13.5, 10 | 13, 9 | 12, 5 | 12, 5 |
| Small-business limit | SEK 120k | DKK 50k | EUR 20k | EUR 40k | EUR 50k | EUR 45k |
| B2G e-invoice | Peppol, 2019 | NemHandel, 2005 | Finvoice/Peppol, 2020 | e-arve, 2019 | Peppol, 2025 | E. sąskaita, 2017 |
| B2B e-invoice | none | none (capability rule) | on request (> EUR 10k) | on request, 2025-07 | mandate 2028-01 | none (i.SAF reporting) |
| Payment reference | OCR (Luhn) | FIK (+71/+75) | viitenumero | viitenumber | free text | free text |
| Local methods | Swish, Bankgiro | MobilePay, Betalingsservice | e-lasku, MobilePay | SEPA, e-invoice | SEPA | SEPA |
| VAT return due | 12th (+1 month), Aug 17 | 1st (+2 months) | 12th (+1 month) | 20th | 20th | 25th, i.SAF 20th |

## Sweden

- **Market**: the largest Nordic SME market. Payments run on Bankgiro with
  OCR references and Swish. Invoices without an OCR number feel unfinished
  to Swedish buyers.
- **VAT**: 25/12/6 %. Food drops temporarily from 12 % to 6 % for
  2026-04-01 – 2027-12-31; restaurants stay at 12 %
  ([Riksdagen](https://www.riksdagen.se/en/news/articles/2026/feb/25/temporarily-reduced-vat-on-food_cmsd274f5ec-c794-4c1f-8eaf-7811a27dfcb5en/)).
- **Exemption**: up to SEK 120,000 since 2025
  ([Skatteverket](https://skatteverket.se/momsbefrielse)).
- **E-invoicing**: Peppol BIS for public-sector buyers since 2019-04-01
  (lag 2018:1277, [DIGG](https://www.digg.se/digitala-tjanster/e-handel/regler-och-krav-for-e-handel/lag-om-e-faktura-vid-offentlig-upphandling)).
- **IDs**: organisationsnummer (Luhn), VAT = SE + orgnr + 01.

## Denmark

- **Market**: very digital. MobilePay and FI-kort (+71) dominate small B2C
  payments, and NemHandel/Peppol is everywhere in the public sector.
- **VAT**: a single 25 % rate. Exemption up to DKK 50,000 per calendar
  year (ML § 48, [Den juridiske vejledning](https://www.tax.dk/jv/da/D_A_14_2_2_2.htm)).
- **E-invoicing**: OIOUBL/Peppol through [NemHandel](https://nemhandel.dk)
  for public buyers since 2005. The Bookkeeping Act requires a registered
  digital system that can send and receive e-invoices
  ([Erhvervsstyrelsen](https://erhvervsstyrelsen.dk/digital-bogfoering)), but it
  does not oblige anyone to send them.
- **IDs**: CVR (mod 11), VAT = DK + CVR.

## Finland

- **Market**: e-invoicing is the norm (Finvoice through banks, e-lasku for
  consumers). The viitenumero is expected on every invoice.
- **VAT**: 25.5 % since 2024-09-01. The reduced rate went from 14 % to
  13.5 % on 2026-01-01 (laki 1358/2025); 10 % is left for newspapers and
  periodicals ([Vero.fi](https://www.vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/rates-of-vat/)).
- **Exemption**: up to EUR 20,000 since 2025.
- **E-invoicing**: under [laki 241/2019](https://www.finlex.fi/fi/laki/alkup/2019/20190241),
  public buyers, and B2B buyers who ask for it (supplier turnover
  > EUR 10,000), have a right to receive an e-invoice.
- **IDs**: Y-tunnus (mod 11, remainder 1 never issued), VAT = FI + 8 digits.

## Estonia

- **Market**: small but highly digital. The e-Business Register has open data.
- **VAT**: 24 % since 2025-07-01, with 13 % for accommodation and 9 % for
  books, press and medicines ([EMTA](https://www.emta.ee/ariklient/maksud-ja-tasumine/kaibemaks)).
  Registration from EUR 40,000.
- **E-invoicing**: public buyers since 2019-07-01. Since 2025-07-01 a B2B
  buyer registered as an e-invoice recipient can demand one
  ([Raamatupidamise seadus](https://www.riigiteataja.ee/akt/RPS)).
- **IDs**: registrikood (two-round mod 11), KMKR (3-7-1 mod 10). The
  viitenumber uses the Finnish 7-3-1 check digit.

## Latvia

- **VAT**: 21/12/5 %. A temporary 12 % applies to bread, milk, poultry and
  eggs from 2026-07-01 to 2027-06-30. Registration from EUR 50,000
  ([VID](https://www.vid.gov.lv/lv/pievienotas-vertibas-nodoklis)).
- **E-invoicing**: Peppol for public authorities from 2025-01-01. The B2B
  mandate is postponed to 2028-01-01 and has been voluntary since 2026-03-30.
- **IDs**: 11-digit registration number (weighted sum ≡ 3 mod 11). VAT =
  LV + reg. no. or personal code (new 32… codes have no checksum).

## Lithuania

- **VAT**: from 2026-01-01 the 9 % rate is gone (Law XV-287). Books moved
  to 5 %; accommodation, passenger transport and culture to 12 %; heating
  and firewood to 21 %. Registration from EUR 45,000
  ([VMI](https://www.vmi.lt/evmi/pridetines-vertes-mokestis)).
- **Reporting**: [i.SAF](https://www.vmi.lt/evmi/i.saf), a monthly register
  of every issued and received VAT invoice, is due on the 20th. It is
  reporting, not e-invoicing, but any LT customer needs an i.SAF export
  from day one.
- **E-invoicing**: E. sąskaita for public buyers since 2017.
- **IDs**: 9-digit company code; PVM = LT + 9 or 12 digits, both mod 11
  with a second weight round.

## Contract gaps

These are things `types.ts` cannot express yet. The packs work around
them with `free_text`, comments or caveats.

1. **Payment reference kinds**: there is no kind for SE OCR (Luhn, with an
   optional length digit) or DK FIK (+71/+73/+75). `fi_reference` is named
   after Finland, but Estonia uses the same 7-3-1 algorithm; a neutral
   `ref_731` would fit both.
2. **QR schemes**: no keys for Swish QR, MobilePay or the Finnish virtual
   bar code (virtuaaliviivakoodi).
3. **Periodic invoice reporting**: there is no model for LT i.SAF and
   i.MAS. They are exported as `LT_ISAF` and described in caveats.
4. **Capability mandates**: the DK Bookkeeping Act requires a system that
   can send and receive e-invoices, but does not require sending them.
   No `EInvoiceMandate.model` fits.
5. **Moved national holidays**: the LV rule that 4 May and 18 November
   move to Monday works, but the contract has no notion of extra working
   Saturdays (Cabinet orders).
6. **Shared helpers**: `se/calendar.ts` (Easter offsets, nth weekday, next
   working day) is used by all six packs. It should move to a shared
   `countries/_shared` folder at registration.
7. **Filing frequency**: deadlines list monthly, quarterly and annual
   filers side by side; the contract cannot say which applies to a tenant.

## Open items

- Re-check every caveat against the primary source before a pack moves to
  `invoicing`, especially the article numbers that are marked "from memory".
- Some Skatteverket and VID deep links are landing pages, not the exact page.
- Native accountant review for LV and LT invoice wording.
