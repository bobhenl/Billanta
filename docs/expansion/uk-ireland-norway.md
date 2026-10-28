# United Kingdom, Ireland, Norway and Iceland – country packs

Status: `supportLevel: 'pack'` (data researched and tested, nothing wired
into the app). Verified 2026-10-28. Code is in
`packages/cz-compliance/src/countries/{gb,ie,no,is}/` and the tests are in
`src/__tests__/countries-gb-ie-no.test.ts`.

Every legal rule in the code cites its source in a comment. Anything that
could not be confirmed is in the pack's `caveats`.

## United Kingdom (GB)

**Market.** This is the largest English-speaking freelancer market in Europe,
with about 4.3 million self-employed people. It is already well served by
accounting-led tools. Billanta's angle would be simple invoicing with voice
input, not bookkeeping.

**Compliance.**
- **VAT number:** 9 digits (12 with a branch suffix), checked with mod 97 or
  the 9755 variant. GD/HA numbers are for government departments and health
  authorities.
- **Northern Ireland:** traders use the `XI` prefix for goods under the
  Windsor Framework.
- **Company number:** 8 characters. A Companies House number must appear on
  invoices (Trading Disclosures Regulations 2015, reg. 24).
- **VAT rates:** 20 / 5 / 0 since 4 January 2011.
- **Registration:** compulsory above GBP 90,000 of turnover.
- **Invoice content:** follows VAT Notice 700 §16.3. Simplified invoices are
  allowed up to GBP 250. Records are kept for 6 years.
- **Making Tax Digital:** all VAT-registered businesses must keep digital
  records and file through MTD software. MTD for Income Tax applies to sole
  traders above GBP 50,000 from April 2026, with quarterly updates due on the
  7th. Filing returns would need HMRC MTD API recognition.
- **E-invoicing:** there is no mandate today. E-invoicing for all VAT
  invoices (B2B and B2G) is announced for April 2029 over Peppol. The
  roadmap is due with Budget 2026, and the law is not passed yet.
- **Payments:** sort code + account number. The check is format-only, with
  no modulus check.
- **Deadlines:**
  - VAT is due 1 month + 7 days after the period ends.
  - Self Assessment is due 31 January, with payments on account on 31 January
    and 31 July.
- **Holidays:** the pack uses the England & Wales list.
  `ukBankHolidays(year, nation)` also covers Scotland and Northern Ireland.

## Ireland (IE)

**Market.** About 330,000 self-employed people. The country uses EUR and
SEPA, so the existing EPC QR code works as it is.

**Compliance.**
- **VAT number:** 7 digits plus a check letter (mod 23), optionally plus a
  second letter. The old format "8Z49289F" is still valid.
- **CRO number:** a plain sequence number with no checksum.
- **VAT rates:**
  - 23 / 13.5 / 9 / 4.8 / 0.
  - From 1 July 2026, restaurants, catering, hot takeaway food and
    hairdressing move to 9%. Hotels stay at 13.5%.
- **Registration thresholds:** EUR 42,500 for services and EUR 85,000 for
  goods.
- **Invoice content:** s. 66 VAT Consolidation Act 2010 and reg. 20 of the
  VAT Regulations 2010. Invoices must be issued within 15 days of the end of
  the month. Records are kept for 6 years.
- **E-invoicing:**
  - B2G: public bodies must accept EN 16931 e-invoices (since 2019).
  - Phase One, from 1 November 2028: large corporates must issue e-invoices
    and real-time reports for domestic B2B. Every business must be able to
    receive e-invoices.
  - Phase Two, from November 2029: wider scope, still being confirmed.
  - July 2030: ViDA.
- **Deadlines:**
  - VAT3 is filed every two months, by the 23rd on ROS.
  - Form 11 and preliminary tax are due 31 October, extended on ROS.
- **Holidays:** 10 public holidays, St Brigid's Day included since 2023.
  There are no substitute days.

## Norway (NO)

**Market.** About 360,000 sole traders (enkeltpersonforetak). The country is
highly digital, and Vipps and eFaktura are standard. The local competition
is strong.

**Compliance.**
- **Organisation number:** 9 digits, mod 11. VAT-registered sellers print it
  as "NO 923 609 016 MVA". Companies listed in Foretaksregisteret must also
  print the word "Foretaksregisteret".
- **VAT rates:** 25 / 15 (food) / 12 (transport, accommodation, culture) / 0.
- **Registration:** above NOK 50,000 in 12 months (merverdiavgiftsloven
  § 2-1).
- **Invoice content:** bokføringsforskriften § 5-1-1, which also requires the
  due date. Sales documents are kept for 5 years.
- **E-invoicing:**
  - B2G: EHF over Peppol has been mandatory since 2019.
  - B2B, from 1 January 2027: VAT-registered businesses must send e-invoices
    to recipients registered in ELMA.
  - From 2030: an obligation to receive e-invoices, plus digital
    bookkeeping.
- **Payments:**
  - The domestic account has 11 digits and a mod 11 check.
  - The KID payment reference is not modelled; see the gaps below.
- **Deadlines:**
  - The MVA-melding is due every two months: 10 April, 10 June, 31 August,
    10 October, 10 December and 10 February.
  - The skattemelding is due 31 May.
  - Deadlines that fall on a weekend or holiday move to the next working
    day.

## Iceland (IS)

**Market.** Very small, with about 20,000 self-employed people. ISK has no
decimals. Payment usually works through bank claims (krafa) rather than bank
transfers. This country is low priority.

**Compliance.**
- **Kennitala:** 10 digits with a mod 11 check digit. Companies add 40 to
  the day.
- **VSK number:** 5–6 digits with no checksum.
- **VAT rates:** 24 / 11 since 2015.
- **Registration:** above ISK 2,000,000.
- **Invoice content:** Reglugerð 50/1993, which requires the seller's and
  the buyer's kennitala. Records are kept for 7 years.
- **E-invoicing:** B2G since 2020 (Regulation 44/2019). There is no B2B
  mandate.
- **Deadlines:** VAT is due on the 5th of the second month after each
  two-month period, moved to the next business day.

## Gaps

### Contract gaps (`types.ts`, not changed here)

1. **No `kid` payment reference.** The Norwegian KID, and the Icelandic bank
   claim, have no matching `reference` value, so `free_text` is used.
2. **No holidays per subdivision.** `holidays(year)` has no subdivision
   argument, so Scotland and Northern Ireland are only reachable through
   `ukBankHolidays`.
3. **One registration threshold.** Ireland has separate thresholds for goods
   and services, but the contract holds one amount.
4. **No field for an invoice issue deadline.** Ireland requires invoices
   within 15 days.
5. **No field for a fixed invoice text.** Norway's "Foretaksregisteret"
   has nowhere to go.
6. **No field for a buyer company ID.** Iceland's buyer kennitala is stored
   as `customer_vat_id`.
7. **No digital-records or filing requirement.** Making Tax Digital in the
   UK and Norway's digital bookkeeping from 2030 have no field. Only
   caveats cover them.
8. **No `when` condition for foreign-currency invoices.**
   `tax_in_local_currency` uses `tax_registered` as the nearest match.
9. **Missing UI locales.** The app has no `nb`, `is` or `ga` locale, so
   every pack lists only `en`.

### Research gaps

- **Not checked for live links:** the source URLs were taken from search
  results or are well-known pages, but none were checked for a live
  response. These are the most likely to have moved: Skatteetaten "frister",
  anskaffelser.no, reglugerd.is, althingi.is and stjornarradid.is.
- **Secondary source only:** Norway's B2B e-invoicing regulations
  (29 September 2026) come from KPMG. Check them against Lovdata.
- **Disputed scope:** sources disagree on the scope of Ireland's Phase Two.
- **Paragraphs to confirm:** the Icelandic paragraph numbers
  (Reglugerð 50/1993, lög 50/1988) need confirming by a local accountant.
- **Possible rate change:** a cut to Norway's food VAT was discussed for
  2026 and not confirmed.
- **Out of scope:**
  - UK sort code modulus checking (Pay.UK tables).
  - Norwegian KID generation.
  - Bank claims (krafa) in Iceland.

## Sources

The full list is in each pack's `sources`. The key ones:

- **GB:**
  - [HMRC VAT Notice 700](https://www.gov.uk/guidance/vat-guide-notice-700)
  - [VAT rates](https://www.gov.uk/vat-rates)
  - [E-invoicing consultation response](https://www.gov.uk/government/consultations/promoting-electronic-invoicing-across-uk-businesses-and-the-public-sector)
  - [Bank holidays](https://www.gov.uk/bank-holidays)
- **IE:**
  - [Revenue – VAT rates](https://www.revenue.ie/en/vat/vat-rates/search-vat-rates/current-vat-rates.aspx)
  - [Revenue – Phase One press release](https://revenue.ie/en/corporate/press-office/press-releases/2026/pr-021026-phase-one-vat-modernisation.aspx)
  - [Citizens Information – Public holidays](https://www.citizensinformation.ie/en/employment/employment-rights-and-conditions/leave-and-holidays/public-holidays/)
- **NO:**
  - [Bokføringsforskriften](https://lovdata.no/dokument/SF/forskrift/2004-12-01-1558)
  - [Merverdiavgiftsloven](https://lovdata.no/dokument/NL/lov/2009-06-19-58)
  - [KPMG on the final e-invoicing regulations](https://kpmg.com/us/en/taxnewsflash/news/2026/10/norway-final-digital-reporting-e-invoicing-regulations.html)
  - [Brønnøysund API](https://data.brreg.no/enhetsregisteret/api/docs/index.html)
- **IS:**
  - [Skatturinn – VAT](https://www.skatturinn.is/english/companies/value-added-tax/)
  - [EC – eInvoicing in Iceland](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing+in+Iceland)

Market sizes are rough figures from national statistics offices, kept only
to set priorities. Check them again before any business decision.
