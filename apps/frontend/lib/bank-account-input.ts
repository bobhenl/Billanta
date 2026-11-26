import { czechAccountToIban } from '@faktur/cz-compliance';

/**
 * The main Czech and Slovak banks by domestic bank code, for the bank code
 * suggestions and so SWIFT (and the Czech IBAN) fill themselves once the
 * account is in. Bank names are proper nouns, the same in every language.
 * The two countries' codes do not overlap for these banks.
 */
export const BANKS: readonly { code: string; name: string; bic?: string; country: 'CZ' | 'SK' }[] = [
  { code: '0100', name: 'Komerční banka', bic: 'KOMBCZPP', country: 'CZ' },
  { code: '0300', name: 'ČSOB', bic: 'CEKOCZPP', country: 'CZ' },
  { code: '0600', name: 'MONETA Money Bank', bic: 'AGBACZPP', country: 'CZ' },
  { code: '0710', name: 'Česká národní banka', bic: 'CNBACZPP', country: 'CZ' },
  { code: '0800', name: 'Česká spořitelna', bic: 'GIBACZPX', country: 'CZ' },
  { code: '2010', name: 'Fio banka', bic: 'FIOBCZPP', country: 'CZ' },
  { code: '2250', name: 'Banka CREDITAS', bic: 'CTASCZ22', country: 'CZ' },
  { code: '2700', name: 'UniCredit Bank', bic: 'BACXCZPP', country: 'CZ' },
  { code: '3030', name: 'Air Bank', bic: 'AIRACZPP', country: 'CZ' },
  { code: '3500', name: 'ING Bank', bic: 'INGBCZPP', country: 'CZ' },
  { code: '4000', name: 'Max banka', bic: 'EXPNCZPP', country: 'CZ' },
  { code: '5500', name: 'Raiffeisenbank', bic: 'RZBCCZPP', country: 'CZ' },
  { code: '5800', name: 'J&T Banka', bic: 'JTBPCZPP', country: 'CZ' },
  { code: '6210', name: 'mBank', bic: 'BREXCZPP', country: 'CZ' },
  { code: '6363', name: 'Partners Banka', country: 'CZ' },
  { code: '0200', name: 'VÚB banka', bic: 'SUBASKBX', country: 'SK' },
  { code: '0900', name: 'Slovenská sporiteľňa', bic: 'GIBASKBX', country: 'SK' },
  { code: '1100', name: 'Tatra banka', bic: 'TATRSKBX', country: 'SK' },
  { code: '1111', name: 'UniCredit Bank SK', bic: 'UNCRSKBX', country: 'SK' },
  { code: '5600', name: '365.bank', bic: 'KOMASK2X', country: 'SK' },
  { code: '6500', name: 'Poštová banka', bic: 'POBNSKBA', country: 'SK' },
  { code: '7500', name: 'ČSOB SK', bic: 'CEKOSKBX', country: 'SK' },
  { code: '8330', name: 'Fio banka SK', bic: 'FIOZSKBA', country: 'SK' },
];

export const BIC_BY_BANK_CODE: Record<string, string> = Object.fromEntries(
  BANKS.filter((b) => b.bic).map((b) => [b.code, b.bic!]),
);

/**
 * "19-123456789/0800" or a pasted CZ/SK IBAN, split into number and bank
 * code; null for anything else (a half-typed number stays as it is).
 */
export function splitAccount(raw: string): { number: string; code: string; iban?: string } | null {
  const value = raw.trim();
  const [, typed, typedCode] = /^((?:\d{1,6}\s*-\s*)?\d{2,10})\s*\/\s*(\d{4})$/.exec(value) ?? [];
  if (typed && typedCode) return { number: typed.replace(/\s/g, ''), code: typedCode };
  const iban = value.replace(/\s/g, '').toUpperCase();
  if (!/^(CZ|SK)\d{22}$/.test(iban)) return null;
  const prefix = iban.slice(8, 14).replace(/^0+/, '');
  const number = iban.slice(14).replace(/^0+/, '');
  return { number: prefix ? `${prefix}-${number}` : number, code: iban.slice(4, 8), iban };
}

export interface AccountFields {
  number: string;
  code: string;
  iban: string;
  swift: string;
}

/**
 * The account fields after the user typed or pasted `raw` into one of them.
 * "310252289/0300" in the number field splits into number and code, a pasted
 * IBAN in either field fills the domestic number, and an empty IBAN or SWIFT
 * is filled from a known Czech bank. Nothing the user already typed into
 * IBAN or SWIFT is overwritten.
 */
export function editAccount(fields: AccountFields, field: 'number' | 'code' | 'iban', raw: string): AccountFields {
  let next: AccountFields;
  if (field === 'code') {
    next = { ...fields, code: raw.replace(/\D/g, '').slice(0, 4) };
  } else {
    const split = splitAccount(raw);
    if (split && (field === 'number' || !fields.number.trim())) {
      next = { ...fields, number: split.number, code: split.code, iban: split.iban ?? fields.iban };
      if (field === 'iban') next.iban = raw;
    } else {
      next = field === 'number' ? { ...fields, number: raw } : { ...fields, iban: raw };
    }
  }
  // A value we filled in follows the account while it is being typed; one the user changed stays.
  if (field !== 'iban' && (!next.iban.trim() || next.iban === autoIban(fields))) next.iban = autoIban(next);
  if (!next.swift.trim() || next.swift === (BIC_BY_BANK_CODE[fields.code] ?? '')) next.swift = BIC_BY_BANK_CODE[next.code] ?? '';
  return next;
}

/** The IBAN of a Czech account at a known bank; '' when it can't be built. */
function autoIban({ number, code }: Pick<AccountFields, 'number' | 'code'>): string {
  const bank = BANKS.find((b) => b.code === code);
  if (bank?.country !== 'CZ' || !/^(\d{1,6}-)?\d{2,10}$/.test(number.trim())) return '';
  return czechAccountToIban(number.trim(), code) ?? '';
}
