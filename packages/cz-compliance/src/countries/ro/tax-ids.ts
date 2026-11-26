/**
 * Romanian identifiers.
 *
 * CUI / CIF (cod unic de înregistrare / cod de identificare fiscală): 2–10
 * digits, the last one a check digit. The body is left-padded to 9 digits and
 * weighted with 7,5,3,2,1,7,5,3,2; the check digit is (sum × 10) mod 11, with
 * 10 written as 0 (the control-key algorithm ANAF's validators apply; the
 * normative act that publishes it is listed in the pack caveats).
 * VAT-registered persons use the CUI with the `RO` prefix (art. 316 Cod fiscal).
 *
 * Trade register number (număr de ordine în Registrul Comerțului, Legea
 * 26/1990 art. 1): the old `J40/1234/2020` form or the format ONRC issues
 * since 2024 (`J2024001234408`, letter + year + 6-digit number + 2-digit
 * county / check part). No public checksum, so only the shape is checked.
 */

const CUI_WEIGHTS = [7, 5, 3, 2, 1, 7, 5, 3, 2];

export const normalizeCui = (value: string): string => value.replace(/[\s.-]/g, '').toUpperCase().replace(/^RO/, '');

export function isValidCui(value: string): boolean {
  if (!/^\d{2,10}$/.test(value)) return false;
  const body = value.slice(0, -1).padStart(9, '0');
  const sum = [...body].reduce((acc, ch, i) => acc + Number(ch) * CUI_WEIGHTS[i]!, 0);
  const check = ((sum * 10) % 11) % 10;
  return check === Number(value.at(-1));
}

export const normalizeRoVatId = (value: string): string => {
  const v = value.replace(/[\s.-]/g, '').toUpperCase();
  return v.startsWith('RO') ? v : `RO${v}`;
};

export const isValidRoVatId = (value: string): boolean => /^RO\d{2,10}$/.test(value) && isValidCui(value.slice(2));

export const normalizeTradeRegister = (value: string): string => value.replace(/\s/g, '').toUpperCase();

// Since 2024 (Legea 265/2022) ONRC issues J + year + 6-digit number + county +
// one control digit. The control digit algorithm is not published, so only the
// shape is checked.
export const isValidTradeRegister = (value: string): boolean =>
  /^[JFC]\d{2}\/\d{1,6}\/(19|20)\d{2}$/.test(value) || /^[JFC](19|20)\d{2}\d{6}\d{2}\d$/.test(value);
