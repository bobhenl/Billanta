# Slovak invoicing competitors – research for SK /compare pages

Checked 2026-10-18. Prices are per month, without VAT, in EUR, taken from each
vendor's public pages on that date. Internal notes, not marketing copy: every
description below is our own summary. Re-read the source pages before any
cell goes live, because several facts were fetched through page summaries
and some vendor pages hide the period totals behind a toggle.

"–" means the vendor's public page does not say (not that the feature is
missing), the same rule as `apps/frontend/lib/competitors.ts`.

## 1. How the current /compare pages work

- Registry: `apps/frontend/lib/competitors.ts`
  - `COMPARED_AT = '2026-10'`, shown as the "verified" month.
  - `BRANDS`: `{ key, name, pricingUrl }`. Today: billanta, fakturoid,
    idoklad, superfaktura, vyfakturuj, bitfaktura. All `pricingUrl`s point to
    the **.cz** price lists.
  - `COMPARED_BRANDS` (all but billanta) each get `/compare/<key>`;
    `generateStaticParams` builds them for every locale.
  - `COMPETITOR_ROWS`: ordered row keys with a `good: BrandKey[]` highlight
    list: `free, entry, bank, ai, voice, taxEstimate, import, api, recurring,
    reminders, einvoice, qr, currencies, czsk, mobile, history`.
  - `TEASER_ROW_KEYS` for the homepage teaser.
- Pages: `app/[locale]/(marketing)/compare/page.tsx` (full table) and
  `compare/[slug]/page.tsx` (Billanta vs one brand: suits-us / suits-them
  lists, free + entry price cards, row table, switch steps, FAQ, JSON-LD).
- Text: `messages/{cs,sk,en}.json` → `comparePage`:
  - `rows.<row>.label` and `rows.<row>.<brandKey>` (one string per cell, per
    locale).
  - `brands.<key>`: `seoTitle, title, lead, suitsUs[], suitsThem[], price,
    switchTitle, switchSteps[], faq[{q,a}]`.
  - `brand.*` shared labels, plus `disclaimer`, `notStated`, `verified`.
- **Gap found:** the `sk` locale shows the Czech data. `sk.json` entry row
  says e.g. SuperFaktura "129 Kč/mes." and Billanta "119 Kč/mes.", and the
  "Source" link goes to superfaktura.cz. A Slovak visitor sees Czech koruna
  prices of the Czech editions. For step 4 the registry needs either
  per-locale brand lists (SK set vs CZ set) or per-locale `pricingUrl` and
  cells in EUR. Billanta SK price is 4.99 €/month yearly, 5.99 € monthly
  (`lib/plans.ts`).

Suggested extra rows for SK (each needs cells in all three locales):
`peppol` (send/receive eFaktúra via a certified provider), `skVat` (DPH
priznanie / kontrolný výkaz / súhrnný výkaz export), `payBySquare` (or fold
into `qr`), optionally `ekasa`/cash register.

## 2. Context: SK eFaktúra mandate

From 1 January 2027 domestic B2B invoices between Slovak VAT payers must be
structured XML (EN 16931 / Peppol BIS) delivered over Peppol through a
certified "digitálny poštár" (PDS). Non-VAT payers must be able to receive.
Legal basis cited by vendors: zákon č. 385/2025 Z. z.
Sources: https://www.superfaktura.sk/efaktura/ ,
https://www.billdu.com/efaktura-slovakia/ ,
https://sovos.com/regulatory-updates/global-vat/slovakia-financial-administration-publishes-expanded-efaktura-faq-ahead-of-2027-mandate/

This is the single biggest switching trigger in SK for 2026/27. Every
competitor page below is judged first on it.

## 3. Competitors

### SuperFaktúra (superfaktura.sk) – market leader for SK freelancers and small firms

- Pricing URL: https://www.superfaktura.sk/cennik/ (package comparison:
  https://www.superfaktura.sk/en/?p=10251)
- Tiers: Základný 4.99 €, Štandardný 9.99 €, Prémiový 16.99 € per month.
  The page has a month / half-year / year switch and shows a "discount" of
  12 / 24 / 36 €; it does not say which period the headline price is for.
  Verify in a browser before quoting (likely the yearly rate).
- Free plan: **no permanent free plan on the SK site**, only a 30-day trial
  and a no-signup one-off invoice generator. (The Czech edition still lists a
  free tier for 5 customers, which is what our current `free` cell shows.)
- Peppol: receiving free and unlimited on all plans, 50 sends/month included,
  more in prepaid packs (50 to 2000, valid 12 months; pack prices in a
  separate list). Presents itself as a PDS intermediary.
  https://www.superfaktura.sk/efaktura/
- Bank: automatic payment matching on all plans, full movement list from
  Štandardný. Integrations page lists Tatra banka, Slovenská sporiteľňa,
  ČSOB, Fio, mBank, Poštová, Prima, Raiffeisen, UniCredit, VÚB, plus Revolut,
  TrustPay and others. https://www.superfaktura.sk/integracia/
- PAY by square: yes, offered to users for free (third-party article:
  https://podnikam.sk/?p=23350). The SK feature page mentions a payment QR
  but not the name.
- Cash register: "Pokladnica" from Štandardný; eKasa not mentioned.
- API: Prémiový only (sandbox at https://sandbox.superfaktura.sk/).
- Recurring invoices and reminders (email + SMS): from Štandardný.
- Users: 1 user + accountant on Basic/Standard, multi-user on Premium.
- Multi-currency: 155 currencies, 14 languages.
  https://www.superfaktura.sk/funkcie/
- Mobile: native iOS and Android.
- Accounting exports: Omega, Pohoda, Money, Alfa+, MRP, Profit365 and more;
  many e-shop connectors (Shoptet, WooCommerce, Shopify, PrestaShop …).
- OSS / kontrolný výkaz export: – (not found on public pages).
- 20 AI document extractions/month on every plan.
- Target: SK freelancers, small firms, e-shops.

Data-shape draft (sk cells):
`free: "Len 30 dní na skúšku"`, `entry: "4,99 €/mes."`, `bank: "Všetky
tarify"`, `api: "Len najvyšší"`, `recurring: "Od 2. plateného"`,
`reminders: "Od 2. plateného, aj SMS"`, `einvoice/peppol: "Peppol, 50
odoslaní/mes. v cene"`, `qr: "PAY by square"`, `currencies: "Áno"`,
`mobile: "iOS, Android"`, `skVat: "–"`.

### KROS Fakturácia (kros.sk/fakturacia) – from the biggest SK accounting-software house

- Pricing URL: https://www.kros.sk/fakturacia/cennik/
- Tiers (monthly rate when paying 12 months): Zadarmo 0 €, Základ 5.90 €,
  Štandard 11.00 €, KROS Firma 14.90 €. A promo code (KROS30) takes 30 %
  off. Add-ons: recurring invoices 1.90 €, API 4.90 € (included in Firma),
  extra user 4.90 €.
- Free plan: non-VAT payers only, 5 business partners (fixed, cannot be
  swapped later per FAQ), 1 company, 1 user + 1 accountant, QR on documents.
- Peppol: receiving free on all plans ("unlimited from autumn"), 50 sends a
  month from Základ; packs 50 for 5.90 € or 2000 for 59.90 €.
  https://www.kros.sk/fakturacia/
- Bank: "automatické úhrady" via linked bank account from Základ; banks not
  named on the page.
- Multi-currency: foreign-currency invoices with current rate, from Základ.
- Accountant: Účtovník role; documents go straight into KROS OMEGA / ALFA
  plus (https://www.podnikajte.sk/uctovne-doklady/kros-fakturacia-moderna-aplikacia-pre-podnikatelov,
  2023 PR article).
- Mobile: browser only, no native app described (same article).
- PAY by square by name, eKasa, OSS, kontrolný výkaz: – on the invoicing
  product (KROS's desktop OMEGA does the tax filings).
- Note: the older free **iKROS** app's domain (ikros.sk) no longer resolves
  (checked 2026-10-18). It looks retired; KROS Fakturácia is the current
  product. Former iKROS users are a switching audience.
- Target: SK sole traders whose accountant runs OMEGA/ALFA.

### iDoklad SK (idoklad.sk) – Czech Money/Solitea product with a Slovak edition

- Pricing URL: https://www.idoklad.sk/cennik
- Tiers: Free 0 €; Základné 5.00 € (yearly) / 5.30 € (quarterly) / 5.90 €
  (monthly); Obľúbené 8.30 / 9.30 / 9.90 €; Prémiové 11.60 / 13.30 / 13.90 €.
  (Order of billing periods inferred from the page; verify.)
- Free plan: 5 contacts, 1 user, mobile app included.
- Bank: automatic matching from Obľúbené (2nd paid).
- API: Prémiové only (75,000 requests/month).
- Users: 1 / 2 / 3 / 9 by tier; accountant collaboration, external
  accounting software link from Základné.
- Mobile: iOS and Android on all tiers.
- Peppol: **not live yet**, launch planned "autumn 2026"; own PDS price list:
  10 € activation, up to 50 sends/month free, 5 € up to 100, then per
  invoice; inbox free. https://www.idoklad.sk/efaktura
- PAY by square, OSS, kontrolný výkaz: –.
- Target: small SK businesses, often with an accountant on Money S3.

### Billdu (billdu.com/sk) – mobile-first app, Slovak origin, UK-registered operator

- Pricing URL: https://www.billdu.com/sk/cennik/
- Tiers: Lite 7.99 € monthly / 4.99 € on yearly, Standard 14.99 / 9.99 €,
  Premium 27.99 / 19.99 €. Client caps: 10 / 50 / unlimited. Users 1 / 2 /
  10.
- Free plan: none, 7-day trial without a card.
- Recurring invoices and API only in Premium; reminders from Standard;
  Lite has no accountant connection.
- Peppol: **not live yet**, promised "ahead of 1 January 2027" via a
  certified partner. https://www.billdu.com/sk/efaktura-na-slovensku/
- Mobile: strong native apps (claims 1.5M users worldwide, 4.8 rating from
  ~70K reviews – their own figures). https://www.billdu.com/sk/
- Online payments via Stripe/PayPal; mentions cooperation with Tatra banka.
- PAY by square, multi-currency, VAT reports: could not verify from the
  public pages (a page summary listed them but did not quote them; treat as
  unverified).
- Target: tradespeople and freelancers who invoice from the phone,
  international.

### Fakturoid (fakturoid.cz) – Czech app with Slovak support

- Pricing URL: https://www.fakturoid.cz/cenik (CZK; no separate .sk site).
- SK support: Slovak language, EUR and other currencies at ECB rate, Slovak
  IČO lookup, bank matching with ČSOB, Fio, Slovenská sporiteľňa and Tatra
  banka, Slovak payment QR (by square) for EUR invoices to a Slovak account.
  https://www.fakturoid.cz/podpora/ucetnictvi/fakturace-pro-slovensko ,
  https://www.fakturoid.cz/blog/2025/11/28/qr-kod-slovensko
- Not offered: Slovak turnover tracking and tax-authority exports (they say
  CZ and SK rules differ).
- Peppol SK: **not finished**, send-only in the first phase via an unnamed
  certified partner, pricing not decided.
  https://www.fakturoid.cz/podpora/faktury/elektronicka-fakturace-slovensko-peppol
- Target: Czech freelancers; Slovaks are a secondary audience. Already has
  a /compare page; for SK its cells should say "no SK tax exports".

### Faktúry online (faktury-online.com) – long-running, nearly free

- https://www.faktury-online.com/
- Free without signup or with free registration; full version 2.50 €/month
  after the first free year (free for NGOs). No numeric limits stated.
- PAY by square QR, API, many document languages. Says it is "Peppol ready"
  with live operation by autumn 2026.
- Claims 169k+ users and 14M+ documents over 17 years (own figures).
- Bank, mobile, accountant, VAT reports: –.
- Target: very price-sensitive sole traders.

### Others noted, not recommended for pages now

- **Money S3 / POHODA (Stormware) / KROS OMEGA** – desktop accounting suites,
  not invoicing apps; better as export targets than as comparison pages.
  Slovak Money S3 pricing was not found on money.cz.
- **1FAKTURA, eFaktúra (platforms)** – Peppol-first newcomers; Capterra
  lists free plans (https://www.capterra.com/p/10045843/1FAKTURA/). Not
  verified on their own sites.
- **FLOWii, Účto+, miniFAKTÚRA, Turbofaktúra** – only covered by a 2021
  comparison (https://www.podnikajte.sk/uctovne-doklady/porovnanie-online-fakturacnych-systemov),
  too stale to cite.

## 4. Billanta for SK (from the repo)

- Price: free 10 documents/month then 0.20 € each; Start 4.99 € yearly /
  5.99 € monthly; Plus 9.99 / 11.99 €; Business 19.99 / 23.99 €
  (`apps/frontend/lib/plans.ts`).
- PAY by square for Slovak suppliers (commit d1ce944).
- SK VAT exports as eDane XML: DPH priznanie (DPHv25), kontrolný výkaz
  (KVDPHv25), súhrnný výkaz (SVDPHv20) – Plus and up
  (`apps/backend/src/exports/vat-returns-sk.ts`, commit 4224a47). No
  competitor above shows this on its invoicing product.
- Slovak company register lookup (migration 0060), books in EUR at the ECB
  rate (commit 9c67244), SK contributions estimate, CZ and SK companies in
  one account.
- Bank: PSD2 via Enable Banking for SK banks, Fio API, uploads incl.
  camt.053, GPC/ABO, CSV (`bank-reconciliation/`).
- UBL 2.1 / Peppol BIS 3.0 XML export with a Peppol rule check
  (`invoices.controller.ts`), **but no Peppol sending or receiving**: no
  access point / PDS partner in the code.
- AI drafts, voice / Telegram / WhatsApp, receipt reading, import from
  Fakturoid / iDoklad / BitFaktura / CSV.
- No native mobile app (installable web app), no SMS reminders, no eKasa or
  cash register, no e-shop connectors listed. OSS: not verified – do not
  claim.

## 5. Recommendation

Build SK pages for these, in this order:

1. **SuperFaktúra** – the brand Slovaks search "alternatíva" for. Our
   cheapest plan matches its price (4.99 €), we have a free plan and it does
   not on .sk, recurring and the API come lower in our ladder, and we export
   KV DPH. Honest loss: it already sends and receives eFaktúra over Peppol
   with 50 free sends, has native apps, SMS reminders, a cash register and a
   much wider integration list.
2. **KROS Fakturácia** – the accountant-driven choice; also catches former
   iKROS users. Our free plan works for VAT payers too (theirs is non-VAT
   only, 5 fixed partners); recurring invoices and API are not paid add-ons.
   Honest loss: tight OMEGA link for KROS accountants, Peppol sending
   included from Základ.
3. **iDoklad** (reuse the existing key, give SK cells in EUR) – free 5
   contacts vs our 10 documents; bank matching and API come later in their
   ladder. Honest loss: native apps; their Peppol is due this autumn.
4. **Billdu** – no free plan, client caps on lower tiers, recurring and API
   only in Premium. Honest loss: best-in-class mobile app.
5. Optional: **Faktúry online** – cheaper than us after year one, but no
   bank matching or VAT exports stated. Only if we want the "free invoice"
   search traffic.

Fakturoid already has a page; just add SK cells (no SK tax exports, Peppol
not finished).

**Billanta's honest advantages in SK:** a real free plan that also covers
VAT payers; SK VAT return, control statement and EC sales list XML;
CZ + SK companies in one account; AI and voice invoicing; PSD2 bank sync with
SK banks on the cheapest paid plan; import from other apps.

**Honest disadvantages and the blocking one:** **no Peppol sending or
receiving.** From 1 January 2027 a Slovak VAT payer cannot use Billanta as
their only invoicing tool for domestic B2B without it, and SuperFaktúra and
KROS already offer it. Until a PDS partner is wired in, SK compare pages must
say so plainly (the current `einvoice` cell "ISDOC aj UBL (Peppol)" reads as
if we deliver over Peppol – reword to "UBL export, odosielanie cez Peppol
pripravujeme" or similar). Also: no native mobile app, no SMS reminders, no
eKasa / cash register, small integration list, no SK track record.

## Sources

- https://www.superfaktura.sk/cennik/
- https://www.superfaktura.sk/en/?p=10251
- https://www.superfaktura.sk/
- https://www.superfaktura.sk/funkcie/
- https://www.superfaktura.sk/integracia/
- https://www.superfaktura.sk/efaktura/
- https://podnikam.sk/?p=23350
- https://www.kros.sk/fakturacia/
- https://www.kros.sk/fakturacia/cennik/
- https://www.podnikajte.sk/uctovne-doklady/kros-fakturacia-moderna-aplikacia-pre-podnikatelov
- https://www.idoklad.sk/cennik
- https://www.idoklad.sk/efaktura
- https://www.billdu.com/sk/
- https://www.billdu.com/sk/cennik/
- https://www.billdu.com/sk/fakturacia
- https://www.billdu.com/sk/efaktura-na-slovensku/
- https://www.billdu.com/efaktura-slovakia/
- https://www.fakturoid.cz/podpora/ucetnictvi/fakturace-pro-slovensko
- https://www.fakturoid.cz/podpora/faktury/elektronicka-fakturace-slovensko-peppol
- https://www.fakturoid.cz/blog/2025/11/28/qr-kod-slovensko
- https://www.faktury-online.com/
- https://www.capterra.com/p/10045843/1FAKTURA/
- https://www.podnikajte.sk/uctovne-doklady/porovnanie-online-fakturacnych-systemov (2021, background only)
- https://sovos.com/regulatory-updates/global-vat/slovakia-financial-administration-publishes-expanded-efaktura-faq-ahead-of-2027-mandate/
