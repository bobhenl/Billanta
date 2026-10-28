# Asia: Thailand, Japan, Hong Kong

Country packs: `packages/cz-compliance/src/countries/{th,jp,hk}`, tests in
`src/__tests__/countries-asia.test.ts`. Support level `pack` (data only,
nothing wired into the app). Checked 2026-10-28; open points are in each
pack's `caveats`.

## Summary

| | TH | JP | HK |
|---|---|---|---|
| Tax | VAT 7 % (statutory 10 %, decree to 2027-09-30) | Consumption tax 10 % / 8 % reduced | none |
| Registration threshold | THB 1.8M | JPY 10M (base period) | – |
| Tax ID | 13 digits, mod 11 | T + 13-digit corporate number | BR No., shape only |
| Invoice title | ใบกำกับภาษี / ใบกำกับภาษีอย่างย่อ | none prescribed (請求書 customary) | none |
| Minor units | 2 | 0 | 2 |
| Payment QR | PromptPay (Thai QR, EMVCo) | none (bank transfer 振込) | FPS (HKMA Common QR, EMVCo) |
| e-invoicing | e-Tax Invoice & e-Receipt, voluntary | Peppol JP PINT, voluntary | none |
| Retention | 5 years | 7 years | 7 years |

## Thailand

- **VAT**: Revenue Code s. 80 sets 10 %, but royal decrees have kept it at
  7 % (6.3 % + 0.7 % local) since 1999, renewed one year at a time. Royal
  Decree No. 807 (Royal Gazette 2026-08-20) covers 2026-10-01 to 2027-09-30
  ([KPMG](https://kpmg.com/us/en/taxnewsflash/news/2026/09/thailand-reduced-7-percent-vat-rate-extended-through-september-2027.html),
  [Nation Thailand](https://nationthailand.com/news/policy/40069105)).
  Registration is compulsory above THB 1.8M a year (s. 81/1).
- **Invoices**: full tax invoice (s. 86/4) with the title "ใบกำกับภาษี",
  seller and buyer name, address, tax ID and head office / branch number;
  abbreviated tax invoice for retail (s. 86/6). Thai language and baht
  unless the Director-General allows otherwise.
- **e-Tax Invoice & e-Receipt**: voluntary XML (ETDA standard) uploaded to
  the RD, or "e-Tax Invoice by Email" for smaller issuers. No mandate found.
- **Deadlines**: P.P.30 by the 15th (paper) or 23rd (e-filing). The 8-day
  e-filing extension is valid to 2027-01-31
  ([Nishimura & Asahi](https://www.nishimura.com/en/knowledge/publications/further-eight-day-extension-for-e-filing-tax-returns-and-online-tax-payments-in-thailand)).
  P.P.30 got a new form on 2026-03-01 with PromptPay as the refund channel
  ([Forvis Mazars](https://www.forvismazars.com/th/en/insights/doing-business-in-thailand/tax/thailand-revenue-department-updates-vat-form)).
- **Holidays**: Bank of Thailand lists for 2026 and 2027
  ([bot.or.th](https://www.bot.or.th/en/financial-institutions-holiday.html)).
  Buddhist holidays are lunar and the cabinet adds bridge days, so other
  years cannot be computed.

## Japan

- **Qualified invoice system** (適格請求書, since 2023-10-01, Consumption Tax
  Act art. 57-4): registration number, transaction date, items with
  reduced-rate marks, totals and tax per rate (rounded once per rate),
  buyer name. Only registered issuers may show consumption tax that the
  buyer can deduct.
- **Transitional measures** (FY2026 reform): input credit on purchases from
  non-registered suppliers is 70 % from 2026-10-01, 50 % from 2028-10-01,
  30 % from 2030-10-01, ending 2031-09-30. The 2割特例 ends with the 2026
  return; certain sole proprietors get a 3割特例 for 2027–2028. Sources:
  [Yamada & Partners](https://www.yamada-partners.jp/reform/r8/c01-2-revision-of-transitional-tax-credit-measures-for-taxable-purchases-from-tax-exempt-businesses),
  [freee](https://support.freee.co.jp/hc/ja/articles/22921113014425),
  [Yayoi](https://www.yayoi-kk.co.jp/kaiketsu/invoice/zeiseikaisei-r8/).
  Check the enacted text on nta.go.jp before using it in the product.
- **Registry**: the NTA's invoice issuer and corporate number sites both
  have a free Web-API with an application ID – a good fit for a
  registration number lookup in the customer form.
- **Holidays**: rule-based plus the equinoxes, which the Cabinet fixes a
  year ahead from the NAOJ almanac (2026: 20 Mar, 23 Sep; 2027: 21 Mar,
  23 Sep).
- **Deadlines**: income tax 15 March, consumption tax for individuals
  31 March, moved to the next business day.

## Hong Kong

No VAT or GST, no statutory invoice content and no e-invoicing. An invoice
only has to support the profits tax records kept for 7 years (IRO s. 51C).
The BR number has 8 digits plus a branch code; since 2023 its first 8 digits
are the Unique Business Identifier shared with the Companies Registry.
Payments run on FPS, whose QR follows the HKMA Common QR Code spec.

## Market

- **Thailand**: about 3 million SMEs, most below the VAT threshold.
  Withholding tax certificates (50 ทวิ) matter as much as invoices, since
  B2B service payments carry 3 % withholding. Thai-language UI and PDFs are
  a must; English works for foreign-owned companies in Bangkok.
- **Japan**: the 2023 invoice reform pushed millions of freelancers to
  register, so demand for simple compliant invoicing is high, but the
  market is mature and expects Japanese-only UI, bank-transfer workflows
  and integration with accounting suites.
- **Hong Kong**: no tax logic to sell. The pitch is speed, FPS QR on the
  invoice and bilingual documents (Traditional Chinese / English).

## Competitors

- **FlowAccount** (TH): the default Thai SME tool; covers quotations,
  tax invoices, withholding certificates and e-Tax, with accountant
  collaboration. Strong local brand and Thai support.
- **freee** (JP): cloud accounting for sole proprietors and small
  companies, with invoicing, tax returns and payroll in one suite.
- **Money Forward** (JP): accounting and back-office suite; its invoicing
  product handles qualified invoices and bulk sending, and it sells widely
  to accounting firms.
- **Xero** (HK): the common choice of HK accountants; invoicing is part of
  a full ledger, priced for companies rather than freelancers.

Billanta's angle would be a lighter, mobile-first invoicing tool with voice
drafting, not a full accounting suite. In JP that is a thin wedge against
freee and Money Forward; in TH and HK it is more open.

## PDF fonts and scripts

- **Thai**: needs a font with Thai glyphs and correct mark stacking
  (Noto Sans Thai, Sarabun – the font government documents use). Thai has
  no spaces between words, so line breaking needs a dictionary-based
  segmenter (ICU / `Intl.Segmenter`); a naive PDF engine breaks lines in
  the middle of words.
- **Japanese**: a CJK font (Noto Sans JP / Noto Serif JP) is large
  (≈ 5–15 MB per weight); subset it when embedding. Line breaking follows
  kinsoku rules (no closing punctuation at line start). Dates may be shown
  in the Japanese era (令和8年) – customary but not required.
- **Hong Kong**: Traditional Chinese with HK glyph forms (Noto Sans HK /
  Noto Sans CJK TC), plus HKSCS characters in some names and addresses.

## Selling SaaS there (foreign ownership)

- **Thailand**: selling a foreign SaaS from abroad needs no Thai entity, but
  foreign digital service providers with Thai B2C revenue over THB 1.8M must
  register for VAT under the e-service rules (since 2021). A Thai company
  majority-owned by foreigners needs a Foreign Business licence for most
  services (Foreign Business Act 1999, List 3); a BOI promotion is the usual
  route. Not legal advice – check with a Thai lawyer.
- **Japan**: no ownership restriction for SaaS. Foreign providers of
  digital services pay consumption tax on B2C sales (reverse charge for
  B2B); from 2025-04-01 platform operators may be liable. To issue
  qualified invoices to Japanese business customers, a foreign provider
  must register as an issuer.
- **Hong Kong**: no restrictions and no consumption tax; a local company is
  quick to set up but not required to sell.

## Gaps

| Gap | Size |
|---|---|
| Contract: no branch / head office field (TH tax invoice, also JP 支店) | S |
| Contract: rate set has no end date, so the TH 7 % decree expiry cannot be stored | S |
| Contract: no place for voluntary e-invoicing schemes (TH e-Tax, JP Peppol) – `einvoicing` holds mandates only | S |
| Contract: no tax rounding mode (JP rounds once per rate per invoice) | S |
| Contract: the TaxIdSpec has no "branch number" companion and HK has two IDs (BR, CR) | S |
| Holidays for TH and HK need a yearly table update; JP equinox each February | S (recurring) |
| Thai and Japanese PDF fonts, Thai line breaking | M |
| PromptPay and FPS QR generation (EMVCo TLV + CRC16) | M |
| JP invoice registration number lookup via the NTA Web-API | M |
| TH withholding tax certificate (50 ทวิ) and WHT on invoices | M |
| JP Electronic Bookkeeping Act storage requirements for e-invoices | M |
| UI and invoice templates in `th`, `ja`, `zh-HK` | L |
| TH e-Tax Invoice XML (ETDA standard, signed) and RD submission | L |
| JP Peppol (JP PINT) send / receive | L |
