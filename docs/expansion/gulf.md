# Gulf expansion – AE, SA, QA, BH, OM

Status: country packs only (`packages/cz-compliance/src/countries/{ae,sa,qa,bh,om}`).
Nothing is wired into the app. Verified 2026-10-21 (AE, SA) and 2026-10-28 (QA, BH, OM).
Each pack's `caveats` list what is unconfirmed; read them before relying on a rule.

## Market in one paragraph per country

| | VAT | Threshold | E-invoicing | Notes |
|---|---|---|---|---|
| **UAE** | 5 % since 2018 | AED 375,000 | Peppol (PINT AE, five-corner), pilot from 2026-07-01, AED 50m+ by 2027-01-01, the rest by 2027-07-01, government around 2027-10-01 | Largest SME market, English is enough on invoices, free zones complicate VAT treatment |
| **Saudi Arabia** | 15 % since 2020-07-01 | SAR 375,000 | ZATCA FATOORA: phase 1 (generation) since 2021-12-04, phase 2 (clearance B2B, reporting B2C) in waves; wave 25 (SAR 187,500+) by 2027-02-01 | Arabic required on invoices, QR and cryptographic stamp, the hardest and largest market |
| **Qatar** | none | – | draft law approved 2026-05-06, phased start expected from 2027-01-01 | Invoicing is commercial only for now; revisit when VAT and the e-invoicing law are in force |
| **Bahrain** | 10 % since 2022 | BHD 37,500 | no mandate; a national platform is being tendered | 3-decimal dinar |
| **Oman** | 5 % since 2021-04-16 | OMR 38,500 | Fawtara (Peppol), mandatory issuing from around April 2027 after a pilot; sources disagree on dates | 3-decimal rial, Arabic required |

The weekend is Saturday–Sunday in the UAE and Friday–Saturday elsewhere. Islamic
holidays follow the moon; the packs carry a hard-coded 2026–2027 estimate table
(`ae/hijri.ts`), so holidays and working-day maths are only approximate.

## Competitors

- **Zoho Books** – the default choice for Gulf SMEs. A broad accounting suite with
  GCC VAT returns and ZATCA phase 2 integration, sold across the whole region.
  Strong on breadth, heavy for a freelancer who only needs to send invoices.
- **Wafeq** – a Gulf-born accounting product with an Arabic-first interface and
  ZATCA support. Aims at small and mid-sized firms in Saudi Arabia and the UAE
  and leans on local accountants as a channel.
- **Qoyod** – a Saudi cloud accounting tool focused on ZATCA compliance, inventory
  and point of sale. Mostly Saudi customers, Arabic first.

Where Billanta could fit: a light, fast invoicing tool for freelancers and very
small firms, with voice-to-draft and a clean bilingual invoice, rather than a full
ledger. The Saudi market demands phase 2 integration before any of that matters.

## Product needs

- **RTL Arabic UI.** `dir="rtl"` per locale, logical CSS properties instead of
  left/right in Tailwind (`ps-`, `pe-`, `ms-`, `me-`), mirrored icons, an Arabic
  font with good numerals, and a choice between Arabic-Indic and Western digits.
- **Bilingual PDF.** Arabic and English side by side on one invoice (Saudi and
  Oman require Arabic, buyers usually want English too). Needs RTL text shaping
  in the PDF renderer, mixed-direction lines, and an embedded Arabic font.
- **3-decimal currencies.** BHD, OMR (and KWD later) have 1,000 minor units. The
  package rule "round with `roundMoney`, two decimals" breaks here.
- **Saudi phase 2.** UBL 2.1 XML with ZATCA extensions, a TLV QR code, an ECDSA
  signature with a ZATCA-issued certificate (CSID), the previous-invoice hash
  chain, and the clearance or reporting API call before the invoice is valid.
- **UAE / Oman Peppol.** PINT AE and the Oman profile through an accredited
  service provider; ties into the existing Peppol access-point work.

## Gap list

| Gap | Size |
|---|---|
| Register the five packs in `countries/index.ts` and export them | S |
| Contract: weekend / working-week field (Fri–Sat vs Sat–Sun) | S |
| Contract: planned or draft mandate flag (Qatar, Oman dates) | S |
| Contract: field list for simplified invoices; "B2C is always simplified" | S |
| Contract: "seller ID is one of these IDs" (SA VAT or CRN) | S |
| Moon-based holiday source that does not need a table update every year | M |
| 3-decimal currency support in `roundMoney`, PDF, UBL and QR | M |
| Arabic (`ar`) locale and RTL layout in the frontend | L |
| Bilingual Arabic/English invoice PDF | M |
| Contract and generator support for QR, cryptographic stamp and hash chain | M |
| ZATCA phase 2: onboarding (CSID), signing, clearance/reporting API | L |
| UAE PINT AE and Oman Fawtara through a Peppol service provider | L |
| Local payment methods (UAEFTS, Aani, Fawri, BenefitPay) | M |
| Legal review of every caveat by a local adviser per country | M |
