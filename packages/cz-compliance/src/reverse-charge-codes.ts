/**
 * Kódy předmětu plnění for domestic reverse charge (přenesení daňové
 * povinnosti, § 92a–92i ZDPH). Kontrolní hlášení (DPHKH1) wants one on every
 * A.1 row (supplier) and B.1 row (customer) as `kod_pred_pl`.
 *
 * Source: the EPO číselník "Kód předmětů plnění" (k_pred_pl),
 * https://mojedane.gov.cz/dpr/epo_ciselnik?C=k_pred_pl, linked from the
 * DPHKH1 structure description at
 * https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_detail.faces?zkratka=DPHKH1
 * (read 2026-10-18). Only codes still valid then are listed: the customs
 * tariff numbers used for waste until 2011 and code 2 (povolenky, until
 * 2014) have an end date there and EPO rejects them for current periods.
 * `name` is the official Czech wording; the apps translate it in their
 * message files.
 */
export const REVERSE_CHARGE_CODES = [
  { code: '1', name: 'Zlato', validFrom: '2011-04-01' },
  { code: '1a', name: 'Zlato - zprostředkování dodání investičního zlata', validFrom: '2017-07-01' },
  { code: '3', name: 'Dodání nemovité věci, pokud se při tomto dodání uplatní daň', validFrom: '2016-01-01' },
  { code: '3a', name: 'Dodání nemovité věci v nuceném prodeji', validFrom: '2017-07-01' },
  { code: '4', name: 'Stavební a montážní práce', validFrom: '2012-01-01' },
  { code: '4a', name: 'Stavební a montážní práce - poskytnutí pracovníků', validFrom: '2017-07-01' },
  { code: '5', name: 'Zboží uvedené v příloze č.5', validFrom: '2012-01-01' },
  { code: '6', name: 'Dodání zboží poskytnutého původně jako záruka', validFrom: '2017-07-01' },
  { code: '7', name: 'Dodání zboží po postoupení výhrady vlastnictví', validFrom: '2017-07-01' },
  { code: '11', name: 'Povolenky na emise podle § 92f zákona o DPH', validFrom: '2015-01-01' },
  { code: '12', name: 'Obiloviny a technické plodiny', validFrom: '2015-04-01' },
  { code: '13', name: 'Kovy', validFrom: '2015-04-01' },
  { code: '14', name: 'Mobilní telefony', validFrom: '2015-04-01' },
  { code: '15', name: 'Integrované obvody', validFrom: '2015-04-01' },
  { code: '16', name: 'Přenosná zařízení pro automatizované zpracování dat', validFrom: '2015-04-01' },
  { code: '17', name: 'Videoherní konzole', validFrom: '2015-04-01' },
  { code: '18', name: 'Dodání certifikátů elektřiny', validFrom: '2016-02-01' },
  { code: '19', name: 'Dodání elektřiny soustavami nebo sítěmi obchodníkovi', validFrom: '2016-02-01' },
  { code: '20', name: 'Dodání plynu soustavami nebo sítěmi obchodníkovi', validFrom: '2016-02-01' },
  { code: '21', name: 'Poskytnutí vymezených služeb elektronických komunikací', validFrom: '2016-10-01' }
] as const;

export type ReverseChargeCode = (typeof REVERSE_CHARGE_CODES)[number]['code'];

/** Just the codes, e.g. for a zod enum. */
export const REVERSE_CHARGE_CODE_VALUES = REVERSE_CHARGE_CODES.map((c) => c.code) as [ReverseChargeCode, ...ReverseChargeCode[]];

const CODE_SET: ReadonlySet<string> = new Set(REVERSE_CHARGE_CODE_VALUES);

export function isReverseChargeCode(value: unknown): value is ReverseChargeCode {
  return typeof value === 'string' && CODE_SET.has(value);
}
