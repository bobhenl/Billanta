# Southeast Europe: SI, HR, GR, CY

Country packs in `packages/cz-compliance/src/countries/{si,hr,gr,cy}`.
Verified 2026-10-21 (SI) and 2026-10-28 (HR, GR, CY). Not registered in
`countries/index.ts` yet; that happens at merge. Each pack's `caveats` list
holds everything that is not confirmed from an official source.

## Summary

| | SI | HR | GR | CY |
|---|---|---|---|---|
| Tax IDs | davčna številka (8 digits, mod 11), VAT `SI` + number | OIB (11 digits, ISO 7064 MOD 11,10), VAT `HR` + OIB | ΑΦΜ (9 digits, mod 11), VAT `EL` + ΑΦΜ | TIC (8 digits + letter), VAT `CY` + TIC |
| VAT rates | 22 / 9.5 / 5 | 25 / 13 / 5 | 24 / 13 / 6 (islands −30 % not modelled) | 19 / 9 / 5 / 0 |
| Small business | EUR 60,000 (ZDDV-1 art. 94) | EUR 60,000 (ZPDV art. 90) | EUR 10,000 (art. 39, from 2025) | EUR 15,600 registration threshold |
| E-invoicing | B2G in force; B2B e-invoice from 2028-01-01 | Fiskalizacija 2.0: B2B and B2C real-time from 2026-01-01, non-VAT issuers from 2027 | myDATA reporting in force; B2B clearance 2026-03-02 (> EUR 1m) and 2026-11-02 (rest) | B2G only; no B2B mandate |
| VAT return | monthly / quarterly, last working day of next month | 20th of next month | last working day of next month | quarterly, 10th of second month |
| Retention | 10 years | 11 years | 5 years (+ open audit) | 6 years |
| Billanta readiness | issue OK; B2B 2028 needs eSLOG / Peppol | **blocked**: needs fiscalisation (FINA) integration | **blocked**: needs myDATA / certified provider | issue OK |

## Slovenia

- VAT: ZDDV-1 (art. 41 rates, art. 82 invoice content, art. 94 small business).
- Simplified invoice up to EUR 100.
- B2B e-invoicing: the law on e-invoice exchange makes structured invoices
  mandatory from 2028-01-01 (post-audit, eSLOG 2.0 / Peppol).
- Cash payments need a fiscal cash register (davčne blagajne, ZDavPR); in
  the caveats, not modelled.
- Sources: [FURS – DDV](https://www.fu.gov.si/davki_in_druge_dajatve/podrocja/davek_na_dodano_vrednost/),
  [ZDDV-1 on PIS](https://pisrs.si/pregledPredpisa?id=ZAKO4701),
  [UJP e-računi](https://www.ujp.gov.si/).

## Croatia

- VAT: Zakon o PDV-u (art. 38 rates, art. 79 invoice content, art. 90 small business).
- Fiskalizacija 2.0 (Zakon o fiskalizaciji, NN 89/2025): every invoice is an
  e-invoice reported to the Tax Administration through an information
  intermediary or FINA, from 2026-01-01 for VAT payers and 2027-01-01 for
  others. B2C invoices for all payment methods are fiscalised (JIR / ZKI).
- Deadlines move to the next working day (Opći porezni zakon art. 87).
- Sources: [Porezna uprava – Fiskalizacija](https://porezna-uprava.gov.hr/fiskalizacija/),
  [Zakon o PDV-u](https://www.zakon.hr/z/186/Zakon-o-porezu-na-dodanu-vrijednost),
  [Sudski registar](https://sudreg.pravosudje.hr/).

## Greece

- VAT: Κώδικας ΦΠΑ (ν. 5144/2024 codification), art. 21 rates, art. 39 small business.
- Invoice content: ν. 4308/2014 art. 9. Every invoice is reported to myDATA
  and carries a MARK and QR code.
- B2B e-invoicing through certified providers: A.1128/2025, phase 2 moved to
  2026-11-02 (A.1197/2026; other reports say October 2026).
- Sources: [AADE – myDATA](https://www.aade.gr/mydata),
  [AADE – ηλεκτρονική τιμολόγηση](https://www.aade.gr/egrafes-polites/ilektroniki-timologisi),
  [AADE – art. 39](https://aade.gr/en/international-issues/vat-scheme-small-businesses-article-39-vat-code-law-28592000).

## Cyprus

- VAT: Law 95(I)/2000, Twelfth Schedule for invoice content, art. 46 retention.
- Registration at EUR 15,600 taxable turnover; below it a business is simply
  not registered (no special scheme text).
- No B2B mandate; ViDA (2030) is the next step.
- Sources: [Tax Department](https://www.mof.gov.cy/mof/tax/taxdep.nsf),
  [Tax For All](https://taxforall.mof.gov.cy/),
  [DRCOR](https://efiling.drcor.mcit.gov.cy/).

## Holidays

GR and CY use Orthodox Easter, implemented locally in
`countries/gr/orthodox-easter.ts` (Meeus Julian algorithm + 13 days, valid
1900–2099). CY imports it from the GR folder. SI and HR use the shared
`easterSunday`.

## Gaps

### Open legal questions (see each pack's `caveats`)

- GR phase 2 start date: 2026-11-02 vs 2026-10-01 / 2026-10-12.
- CY: a 3 % rate reported by secondary sources, not confirmed.
- HR: the small-business invoice note cites art. 90 st. 1; some sources use st. 2.
- GR and CY: invoice requirement paragraph letters not re-read against the 2026 consolidated texts.
- SI: older sources still show the EUR 50,000 threshold; EUR 60,000 applies from 2025.

### Contract gaps (`countries/types.ts`)

1. **Payment references**: no option for the SI (SI-model) or HR (HR-model,
   HUB3) structured references, nor the GR RF / DIAS payment codes. All
   four packs use `sepa_rf` or `free_text`.
2. **Orthodox Easter**: no shared helper next to `easterSunday`; it lives in
   the GR folder and CY imports across folders. Move it to
   `public-holidays.ts` at merge.
3. **Regional rates**: the GR islands' reduced rates have nowhere to go;
   rate sets need a subdivision (island / region) key.
4. **Fiscalisation**: no field for B2C fiscal-receipt duties (HR
   Fiskalizacija JIR / ZKI, SI davčne blagajne EOR / ZOI, GR ΦΗΜ / POS
   link), for premises / device registration or for the HR invoice number
   shape (`number/premises/device`).
5. **Clearance proof on the invoice**: no field for the GR MARK and QR, or
   the HR JIR, that must be printed once the authority answers.
6. **E-invoice formats**: `formats` are free strings (`eslog_2_0`,
   `mydata_xml`, `en16931_hr_cius`); a shared union would catch typos.
7. **Deadline weekend rule**: each pack moves dates its own way; a
   `shiftToWorkingDay` option on the contract would remove the copies.
