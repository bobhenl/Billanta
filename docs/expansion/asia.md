# Asia: Thailand, Japan, Hong Kong (WIP research notes)

Draft. The country packs (`packages/cz-compliance/src/countries/{th,jp,hk}`)
are not written yet; these are the verified facts to build them from.
Checked 2026-10-21.

## Thailand (TH)

- **Tax ID**: 13 digits, also the juristic person number. Check digit:
  `(11 - (Σ d[i]·(13-i), i = 0..11) mod 11) mod 10`. Example
  `0107544000108` passes. Invoices also need the branch
  ("สำนักงานใหญ่" / 5-digit branch no.) – the contract has no field for it.
- **VAT**: statutory 10 % (Revenue Code s. 80), cut to 7 % (6.3 % + 0.7 %
  local) by royal decree. Royal Decree No. 807 (Royal Gazette 2026-08-20)
  keeps 7 % from 2026-10-01 to 2027-09-30.
  Sources: [Nation Thailand](https://nationthailand.com/news/policy/40069105),
  [KPMG](https://kpmg.com/us/en/taxnewsflash/news/2026/09/thailand-reduced-7-percent-vat-rate-extended-through-september-2027.html),
  [Forvis Mazars](https://www.forvismazars.com/th/en/insights/doing-business-in-thailand/tax/thailand-maintains-7-vat-rate-for-another-year).
  Registration threshold THB 1.8M turnover (s. 81/1).
- **Invoice**: full tax invoice "ใบกำกับภาษี" (s. 86/4), abbreviated
  "ใบกำกับภาษีอย่างย่อ" for retail (s. 86/6). Thai language and baht unless
  the Director-General allows otherwise. Retention 5 years (s. 87/3).
- **e-Tax Invoice & e-Receipt**: voluntary, no mandate found.
- **Deadlines**: P.P.30 by the 15th (paper) / 23rd (e-filing). The 8-day
  e-filing extension (MoF Notification No. 7, 2024-01-12) runs to
  2027-01-31; renewal not yet found. New P.P.30 form from 2026-03-01.
- **Payments**: PromptPay QR (Thai QR Payment, EMVCo merchant-presented).
- **Holidays**: Bank of Thailand official lists for 2026 and 2027
  (JSON: `bot.or.th/content/bot/en/financial-institutions-holiday/jcr:content/root/container/holidaycalendar.model.<year>.json`).
  2026: 01-01, 01-02, 03-03, 04-06, 04-13..15, 05-01, 05-04, 06-01 (sub.
  Visakha Bucha), 06-03, 07-28, 07-29, 08-12, 10-13, 10-23, 12-07 (sub.),
  12-10, 12-31 (10-16 Bangkok only). 2027: 01-01, 02-22 (sub. Makha Bucha),
  04-06, 04-13..15, 05-03 (sub.), 05-04, 05-20, 06-03, 07-19 (sub.), 07-28,
  08-12, 10-13, 10-25 (sub.), 12-06 (sub.), 12-10, 12-31.

## Japan (JP)

- **Registration number**: `T` + 13 digits. Corporate number check digit
  (first digit) = `9 - (Σ P_n·Q_n mod 9)`, P_n the n-th of the 12 base
  digits from the right, Q_n = 1 odd / 2 even. NTA's own `7000012050002`
  passes. Sole proprietors' numbers: same shape assumed – to confirm.
- **Consumption tax**: 10 % (7.8 + 2.2 local), 8 % reduced (food, newspapers)
  since 2019-10-01; 8 % from 2014-04-01. Exemption: base-period sales
  ≤ JPY 10M.
- **Qualified invoice (適格請求書)** since 2023-10-01, Consumption Tax Act
  art. 57-4. Transitional input credit for purchases from non-registered
  suppliers, per the FY2026 reform: 70 % 2026-10-01..2028-09-30, 50 % to
  2030-09-30, 30 % to 2031-09-30 (freee, Yayoi, Yamada explanations –
  confirm enactment on nta.go.jp). 2割特例 to the 2026 return; 3割特例 for
  certain individuals for 2027–2028.
- **Holidays**: rule-based (substitute + citizens' holiday) plus equinoxes:
  2026-03-20, 2026-09-23, 2027-03-21 (sub. 03-22), 2027-09-23.
- **Deadlines**: income tax 15 Mar, consumption tax (individuals) 31 Mar,
  moved to the next business day.

## Hong Kong (HK)

- No VAT/GST. BR number: 8 digits (+3 branch, full certificate
  8-3-2-2-X). Retention 7 years (IRO s. 51C). FPS QR.
- General holidays (gov.hk): 2026: 01-01, 02-17..19, 04-03, 04-04, 04-06,
  04-07, 05-01, 05-25, 06-19, 07-01, 09-26, 10-01, 10-19, 12-25, 12-26.
  2027: 01-01, 02-06, 02-08, 02-09, 03-26, 03-27, 03-29, 04-05, 05-01,
  05-13, 06-09, 07-01, 09-16, 10-01, 10-08, 12-25, 12-27.

## Still to write

Market, competitors (FlowAccount, freee, Money Forward, Xero HK), Thai/
Japanese PDF fonts, foreign-ownership notes, gap list with S/M/L.
