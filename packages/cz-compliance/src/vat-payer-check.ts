/**
 * Is this DIČ / VAT number really registered for VAT?
 *
 * - CZ: the Ministry of Finance "Registr plátců DPH" web service (ADIS,
 *   `rozhraniCRPDPH`, operation `getStatusNespolehlivyPlatceRozsireny`). It
 *   answers per DIČ: a VAT payer (with the unreliable-payer flag and the bank
 *   accounts published under §96 ZDPH), or NENALEZEN = not in the register.
 *   Public and key-less. WSDL:
 *   https://adisrws.mfcr.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP?wsdl
 * - Other EU states (and CZ/SK as a fallback): VIES `check-vat-number`.
 *
 * Every failure (timeout, 5xx, a member state being offline in VIES) comes
 * back as `unknown`, never as "not a payer": callers show a badge, and a
 * wrong "Neplátce" badge is worse than none.
 */
import { czechAccountToIban, normalizeIban } from './bank-account-validator.js';
import { parseVatId } from './foreign-registries.js';

export type VatPayerState = 'payer' | 'unreliable' | 'not_registered' | 'valid' | 'invalid' | 'unknown';

export interface VatPayerCheck {
  /** Normalised VAT id that was checked, e.g. "CZ27604977". */
  vatId: string;
  /**
   * - `payer` / `unreliable` – CZ register: a VAT payer, `unreliable` = nespolehlivý plátce (§106a ZDPH);
   * - `not_registered` – CZ register does not know the DIČ (neplátce, or an identified person);
   * - `valid` / `invalid` – VIES answer for other EU states;
   * - `unknown` – the service could not be asked.
   */
  state: VatPayerState;
  source: 'ADIS' | 'VIES' | null;
  name: string | null;
  /** Bank accounts the payer published in the CZ register ("123-456789/0100" or an IBAN). */
  bankAccounts: string[];
}

const ADIS_URL = 'https://adisrws.mfcr.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP';
const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

const attr = (xml: string, name: string): string | null => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1] ?? null;
const text = (xml: string, name: string): string | null => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[1]!.replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim() || null : null;
};

/** Parses one ADIS `StatusNespolehlivyPlatceRozsirenyResponse` (exported for tests). */
export function parseAdisResponse(xml: string, dicDigits: string): Omit<VatPayerCheck, 'vatId'> {
  const unknown = { state: 'unknown' as const, source: null, name: null, bankAccounts: [] };
  if (attr(xml, 'statusCode') !== '0') return unknown;
  const block = new RegExp(`<(?:\\w+:)?statusPlatceDPH[^>]*\\bdic="${dicDigits}"[^>]*?(?:/>|>[\\s\\S]*?</(?:\\w+:)?statusPlatceDPH>)`).exec(xml)?.[0];
  if (!block) return unknown;
  const flag = attr(block, 'nespolehlivyPlatce');
  if (flag === 'NENALEZEN') return { state: 'not_registered', source: 'ADIS', name: null, bankAccounts: [] };
  if (flag !== 'ANO' && flag !== 'NE') return unknown;
  const bankAccounts: string[] = [];
  for (const m of block.matchAll(/<(?:\w+:)?standardniUcet\b([^>]*)\/?>/g)) {
    const prefix = attr(m[1]!, 'predcisli');
    const number = attr(m[1]!, 'cislo');
    const bank = attr(m[1]!, 'kodBanky');
    if (number && bank) bankAccounts.push(`${prefix ? `${prefix}-` : ''}${number}/${bank}`);
  }
  for (const m of block.matchAll(/<(?:\w+:)?nestandardniUcet\b([^>]*)\/?>/g)) {
    const iban = attr(m[1]!, 'cislo');
    if (iban) bankAccounts.push(iban);
  }
  return { state: flag === 'ANO' ? 'unreliable' : 'payer', source: 'ADIS', name: text(block, 'nazevSubjektu'), bankAccounts };
}

async function checkAdis(dicDigits: string, timeoutMs: number): Promise<Omit<VatPayerCheck, 'vatId'>> {
  const body =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:roz="http://adis.mfcr.cz/rozhraniCRPDPH/">' +
    `<soapenv:Body><roz:StatusNespolehlivyPlatceRozsirenyRequest><roz:dic>${dicDigits}</roz:dic></roz:StatusNespolehlivyPlatceRozsirenyRequest></soapenv:Body></soapenv:Envelope>`;
  const res = await fetch(ADIS_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '"getStatusNespolehlivyPlatceRozsireny"' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ADIS responded ${res.status}`);
  return parseAdisResponse(await res.text(), dicDigits);
}

async function checkVies(country: string, number: string, timeoutMs: number): Promise<Omit<VatPayerCheck, 'vatId'>> {
  const res = await fetch(VIES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ countryCode: country, vatNumber: number }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`VIES responded ${res.status}`);
  // A member state that is offline answers with `userError` (MS_UNAVAILABLE, TIMEOUT …) rather than valid=false.
  const data = (await res.json()) as { valid?: boolean; name?: string; userError?: string };
  if (typeof data.valid !== 'boolean' || (data.userError && data.userError !== 'VALID' && data.userError !== 'INVALID')) {
    return { state: 'unknown', source: null, name: null, bankAccounts: [] };
  }
  const name = data.name && data.name !== '---' ? data.name.trim() : null;
  return { state: data.valid ? 'valid' : 'invalid', source: 'VIES', name, bankAccounts: [] };
}

/**
 * Checks a DIČ / EU VAT number. A bare Czech number ("27604977") counts as CZ.
 * Returns `null` for input that is not a VAT id at all.
 */
export async function checkVatPayer(input: string, opts: { timeoutMs?: number } = {}): Promise<VatPayerCheck | null> {
  const raw = input.replace(/[\s.-]/g, '').toUpperCase();
  const parsed = parseVatId(/^\d{8,10}$/.test(raw) ? `CZ${raw}` : raw);
  if (!parsed) return null;
  const vatId = `${parsed.country}${parsed.number}`;
  const timeoutMs = opts.timeoutMs ?? 6000;
  try {
    if (parsed.country === 'CZ' && /^\d{8,10}$/.test(parsed.number)) {
      const adis = await checkAdis(parsed.number, timeoutMs).catch(() => null);
      if (adis && adis.state !== 'unknown') return { vatId, ...adis };
    }
    return { vatId, ...(await checkVies(parsed.country, parsed.number, timeoutMs)) };
  } catch {
    return { vatId, state: 'unknown', source: null, name: null, bankAccounts: [] };
  }
}

/** A domestic "[prefix-]number/bank" or an IBAN, as one comparable IBAN string (null = neither). */
function accountKey(account: string): string | null {
  const compact = account.replace(/\s+/g, '');
  if (compact.includes('/')) return czechAccountToIban(compact);
  const iban = normalizeIban(compact);
  return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban) ? iban : null;
}

/**
 * Whether `account` is one of the accounts a payer published in the CZ
 * register (§ 96 and § 109 odst. 2 písm. c) ZDPH: paying a supplier more than
 * twice the cash-payment limit to an unpublished account makes the buyer
 * liable for the VAT). Domestic numbers and IBANs compare as the same
 * account, leading zeros don't matter. Null when `account` is not an account
 * number at all.
 */
export function isPublishedAccount(published: readonly string[], account: string): boolean | null {
  const key = accountKey(account);
  if (!key) return null;
  return published.some((p) => accountKey(p) === key);
}
