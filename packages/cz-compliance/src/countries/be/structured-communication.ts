/**
 * Belgian structured communication (gestructureerde mededeling /
 * communication structurée), `+++123/4567/89002+++`: ten digits of
 * reference plus two check digits = the ten digits mod 97, or 97 when the
 * remainder is 0 (Febelfin standard for OGM/VCS). Banks match incoming
 * transfers on it, so it goes on the PDF, into the EPC QR (structured
 * remittance) and into UBL `cbc:PaymentID`.
 */

const BASE_MAX = 9_999_999_999;

function checkDigits(base: string): string {
  const r = Number(BigInt(base) % 97n);
  return String(r === 0 ? 97 : r).padStart(2, '0');
}

/**
 * Builds a structured communication from a non-negative integer reference
 * (e.g. the invoice's sequence number), left-padded to ten digits.
 */
export function beStructuredCommunication(reference: number | string): string {
  const digits = String(reference).replace(/\D/g, '');
  if (digits === '' || digits.length > 10 || Number(digits) > BASE_MAX) {
    throw new RangeError('Structured communication reference must be 1–10 digits');
  }
  const base = digits.padStart(10, '0');
  const all = base + checkDigits(base);
  return `+++${all.slice(0, 3)}/${all.slice(3, 7)}/${all.slice(7)}+++`;
}

/** The 12 bare digits of a structured communication, or null when the format is wrong. */
export function parseBeStructuredCommunication(value: string): string | null {
  const v = value.replace(/\s/g, '');
  const m = /^(?:\+{3}|\*{3})?(\d{3})\/?(\d{4})\/?(\d{5})(?:\+{3}|\*{3})?$/.exec(v);
  return m ? m[1]! + m[2]! + m[3]! : null;
}

/** Accepts `+++…+++`, `***…***` (some banks print stars) and the bare 12 digits. */
export function validateBeStructuredCommunication(value: string): boolean {
  const digits = parseBeStructuredCommunication(value);
  if (!digits) return false;
  return checkDigits(digits.slice(0, 10)) === digits.slice(10);
}
