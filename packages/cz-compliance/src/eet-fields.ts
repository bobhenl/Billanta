/**
 * EET 2.0 (evidence tržeb) data fields, formats and endpoints. Pure code,
 * safe for the browser; signing and sending live in `@faktur/cz-compliance/eet`.
 *
 * Law: zákon č. 180/2026 Sb., o evidenci tržeb, effective 1. 1. 2027
 * (https://e-sbirka.gov.cz/sb/2026/180). Interface: "Elektronická evidence
 * tržeb 2.0 – Popis datového rozhraní" of 25. 8. 2026, message format v4.1
 * (https://eet.gov.cz/cs/pro-vyvojare). Section numbers below refer to that
 * document unless they start with "§".
 */

export const EET_NAMESPACE = 'http://fs.gov.cz/eet/schema/v4';
export const EET_SOAP_ACTION = 'http://fs.gov.cz/eet/OdeslaniTrzby';

export type EetEnvironment = 'playground' | 'production';

/**
 * Endpoints from "Přístupové a provozní informace" (playground and
 * production). Playground is the default everywhere: production is only used
 * when a tenant explicitly switches to it.
 */
export const EET_ENDPOINTS: Record<EetEnvironment, string> = {
  playground: 'https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',
  production: 'https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',
};
export const EET_DEFAULT_ENVIRONMENT: EetEnvironment = 'playground';

/** § 19 odst. 2: the cash register waits for the reply at least 2 s before it counts as unanswered. */
export const EET_MIN_RESPONSE_TIMEOUT_MS = 2000;
/** § 20: a record that got no reply in time must be sent again within 48 hours. */
export const EET_RESEND_DEADLINE_MS = 48 * 60 * 60 * 1000;
/** Section 2.2.3 item 5: the whole message including the SOAP envelope. */
export const EET_MAX_MESSAGE_BYTES = 12 * 1024;

// XSD patterns from EETXMLSchema.xsd (v4.1). Anchored here, XSD patterns are implicitly anchored.
export const EET_PATTERNS = {
  eic: /^CZ[0-9]{8,10}$/,
  idJednotky: /^[1-9][0-9]{0,8}$/,
  idPokl: /^[0-9a-zA-Z.,:;/#\-_ ]{1,20}$/,
  poradCis: /^[0-9a-zA-Z.,:;/#\-_ ]{1,25}$/,
  dateTime: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/,
  amount: /^((0|-?[1-9]\d{0,7})\.\d\d|-0\.(0[1-9]|[1-9]\d))$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  pok: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}-[0-9a-fA-F]{2}$/,
} as const;

/**
 * Section 2.2.4 item 5: DIS+ assigns evidenční jednotka numbers with at least
 * two digits whose last digit (1–4) is the unit type. Anything else is still
 * accepted by the XSD but answered with warning 6, so the settings form
 * rejects it up front.
 */
export function isAssignedIdJednotky(id: string): boolean {
  return EET_PATTERNS.idJednotky.test(id) && id.length >= 2 && /[1-4]$/.test(id);
}

/** EIČ is the DIČ for most payers (§ 17 odst. 1 písm. a)). */
export function isValidEic(eic: string): boolean {
  return EET_PATTERNS.eic.test(eic);
}

export class EetFieldError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'EetFieldError';
  }
}

/**
 * Formats an amount for celk_trzba and friends: CZK, two decimals, absolute
 * value below 100 million (section 3.3.3.12). Accepts a
 * numeric string (Postgres numeric) or a number. Extra decimals are rounded
 * half away from zero with integer arithmetic, so "0.005" becomes "0.01".
 */
export function formatEetAmount(value: string | number): string {
  const s = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(6) : 'x') : value.trim();
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new EetFieldError('invalid_amount');
  const negative = m[1] === '-';
  const frac = (m[3] ?? '').padEnd(3, '0');
  let cents = BigInt(m[2]!) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1n;
  if (cents >= 10_000_000_000n) throw new EetFieldError('amount_out_of_range');
  const whole = (cents / 100n).toString();
  const rest = (cents % 100n).toString().padStart(2, '0');
  // "-0.00" does not match the XSD; a zero is always "0.00".
  return `${negative && cents > 0n ? '-' : ''}${whole}.${rest}`;
}

/**
 * Local Prague time with its offset, e.g. 2027-01-09T16:45:36+01:00. The
 * interface (section 3.3.3.2) asks for local Czech time with +01:00 in winter
 * and +02:00 in summer. Milliseconds are dropped (the XSD has none).
 */
export function formatEetDateTime(date: Date, timeZone = 'Europe/Prague'): string {
  if (Number.isNaN(date.getTime())) throw new EetFieldError('invalid_date');
  const whole = new Date(Math.floor(date.getTime() / 1000) * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(whole)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const offsetMin = Math.round((Date.parse(`${local}Z`) - whole.getTime()) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** The <Data> element (section 3.3.3). Optional attributes are left out when undefined, never sent empty. */
export interface EetSaleData {
  /** § 17 odst. 1 písm. a) */
  eicPopl: string;
  /** § 17 odst. 2 písm. c), only when another payer delegated recording to this one. */
  eicPoverujiciho?: string;
  /** § 17 odst. 2 písm. c), the sale belongs to several payers. */
  povereniVicePopl?: boolean;
  /** § 17 odst. 1 písm. b), assigned in DIS+. */
  idJednotky: string;
  /** § 17 odst. 1 písm. c) */
  idPokl: string;
  /** § 17 odst. 1 písm. d), a logical series chosen by the payer. */
  poradCis: string;
  /** § 17 odst. 1 písm. e), already formatted (see `formatEetDateTime`). */
  datTrzby: string;
  /** § 17 odst. 1 písm. f), CZK, formatted (see `formatEetAmount`). */
  celkTrzba: string;
  /** § 17 odst. 2 písm. a) */
  urcenoCerpZuct?: string;
  /** § 17 odst. 2 písm. b) */
  cerpZuct?: string;
}

/** Hard checks the XSD would fail on (error 3) or that the server rejects (error 6). */
export function validateEetSaleData(data: EetSaleData): string[] {
  const errors: string[] = [];
  if (!isValidEic(data.eicPopl)) errors.push('invalid_eic');
  if (data.eicPoverujiciho !== undefined && !isValidEic(data.eicPoverujiciho)) errors.push('invalid_eic_poverujiciho');
  if (!EET_PATTERNS.idJednotky.test(data.idJednotky)) errors.push('invalid_id_jednotky');
  if (!EET_PATTERNS.idPokl.test(data.idPokl)) errors.push('invalid_id_pokl');
  if (!EET_PATTERNS.poradCis.test(data.poradCis)) errors.push('invalid_porad_cis');
  if (!EET_PATTERNS.dateTime.test(data.datTrzby)) errors.push('invalid_dat_trzby');
  for (const [key, v] of [
    ['celk_trzba', data.celkTrzba],
    ['urceno_cerp_zuct', data.urcenoCerpZuct],
    ['cerp_zuct', data.cerpZuct],
  ] as const) {
    if (v !== undefined && !EET_PATTERNS.amount.test(v)) errors.push(`invalid_${key}`);
  }
  return errors;
}

/**
 * Section 4: the server treats two messages with the same six base values as
 * the same sale. Resending with unchanged <Data> is therefore safe, which is
 * what makes the § 20 retry idempotent.
 */
export function eetSaleKey(data: Pick<EetSaleData, 'eicPopl' | 'idJednotky' | 'idPokl' | 'poradCis' | 'datTrzby' | 'celkTrzba'>): string {
  return [data.eicPopl, data.idJednotky, data.idPokl, data.poradCis, data.datTrzby, data.celkTrzba].join('|');
}

/**
 * Section 2.2.4 item 4: earliest sale time each environment accepts without
 * warning 5 (playground v4: 1. 7. 2026; production before 2027: 1. 11. 2026;
 * production: 1. 1. 2027). Production accepts test traffic from 1. 11. 2026
 * because § 14, 15 and 18 apply from then (§ 29).
 */
export function eetMinSaleDate(env: EetEnvironment, now: Date = new Date()): Date {
  if (env === 'playground') return new Date('2026-07-01T00:00:00+02:00');
  return now < new Date('2027-01-01T00:00:00+01:00')
    ? new Date('2026-11-01T00:00:00+01:00')
    : new Date('2027-01-01T00:00:00+01:00');
}

/** Section 3.5.4. */
export const EET_ERROR_CODES: Record<number, string> = {
  [-1]: 'temporary_technical_error',
  0: 'verification_ok',
  2: 'invalid_xml_encoding',
  3: 'xsd_validation_failed',
  4: 'invalid_signature',
  6: 'invalid_eic_structure',
  7: 'message_too_large',
  8: 'technical_or_data_error',
};

/** Section 3.4.4. */
export const EET_WARNING_CODES: Record<number, string> = {
  1: 'eic_differs_from_certificate',
  2: 'invalid_eic_poverujiciho',
  4: 'sale_time_after_receipt',
  5: 'sale_time_too_old',
  6: 'id_jednotky_not_assigned_format',
  7: 'eic_poverujiciho_equals_eic',
};

/**
 * Error -1 asks to send later. Every other error code means the message
 * itself is wrong, so resending the same bytes would fail again.
 */
export function isRetryableEetError(kod: number): boolean {
  return kod === -1;
}
