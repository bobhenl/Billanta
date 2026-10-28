/**
 * Hungarian identifiers.
 *
 * Adószám (Art. 2017. évi CL. törvény, 23. §): `xxxxxxxx-y-zz`. The first
 * eight digits are the törzsszám; its 8th digit is a check digit over the
 * first seven with weights 9,7,3,1,9,7,3 ((10 − sum mod 10) mod 10). `y` is
 * the VAT code (1 exempt / not VAT-liable, 2 VAT payer, 3 simplified
 * regime (e.g. KATA), 4 group member, 5 group representative) and `zz` the
 * county tax office code (02–20, 22–44, 51).
 *
 * Közösségi adószám (EU VAT ID): `HU` + the törzsszám.
 *
 * Cégjegyzékszám (company register number, 2006. évi V. törvény): `cc-ff-nnnnnn`
 * (court, company form, sequence). No checksum, so only the shape is checked.
 */

const WEIGHTS = [9, 7, 3, 1, 9, 7, 3];

export function isValidTorzsszam(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(value[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(value[7]);
}

/** Accepts `12345676-2-41`, `12345676241` or with spaces; stores the dashed form. */
export function normalizeAdoszam(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 8)}-${digits[8]}-${digits.slice(9)}` : value.trim();
}

export function isValidAdoszam(value: string): boolean {
  const m = /^(\d{8})-([1-5])-(\d{2})$/.exec(value);
  if (!m) return false;
  const county = Number(m[3]);
  const countyOk = (county >= 2 && county <= 20) || (county >= 22 && county <= 44) || county === 51;
  return countyOk && isValidTorzsszam(m[1]!);
}

export const normalizeHuVatId = (value: string): string => {
  const v = value.replace(/[\s.-]/g, '').toUpperCase();
  return v.startsWith('HU') ? v : `HU${v}`;
};

export const isValidHuVatId = (value: string): boolean => /^HU\d{8}$/.test(value) && isValidTorzsszam(value.slice(2));

export function normalizeCegjegyzekszam(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}` : value.trim();
}

/** Court codes 01–20 (01 = Budapest), company-form codes 01–23. */
export function isValidCegjegyzekszam(value: string): boolean {
  const m = /^(\d{2})-(\d{2})-(\d{6})$/.exec(value);
  if (!m) return false;
  const court = Number(m[1]);
  const form = Number(m[2]);
  return court >= 1 && court <= 20 && form >= 1 && form <= 23;
}
