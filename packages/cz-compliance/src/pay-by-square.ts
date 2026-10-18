/**
 * PAY by square generator: the Slovak Banking Association's payment QR
 * code, the Slovak counterpart of the Czech QR Platba (SPAYD). Every Slovak
 * banking app reads it.
 *
 * Spec: "by square – PAY specifications 1.2.0", Slovenská banková asociácia,
 * https://www.sbaonline.sk/wp-content/uploads/2020/03/bysquare-PAYspecifications-1.2.0.pdf
 *
 * Encoding (spec 3.8–3.13):
 *   1. Field values in the XSD order, joined by horizontal tabs (UTF-8).
 *   2. CRC32 of that sequence, little-endian, put in front of it.
 *   3. Raw LZMA1 (lc=3, lp=0, pb=2, dictionary 2^17), no .lzma header.
 *   4. Prefixed with the 2-byte by square header (type, version, document
 *      type, reserved: 4 bits each, all 0 for PAY) and the uncompressed
 *      size as a little-endian 16-bit word.
 *   5. Base32hex (0–9, A–V) over the bit stream, zero-padded to 5 bits.
 *
 * The payload is a few hundred bytes at most, so the LZMA stream here codes
 * every byte as a literal: a valid stream any LZMA decoder reads, without
 * pulling in a full compressor.
 */

export interface PayBySquareParams {
  /** Beneficiary IBAN. Required. */
  iban: string;
  bic?: string;
  /** Amount payable; left out for "any amount". */
  amount?: number;
  /** ISO 4217, defaults to EUR. */
  currency?: string;
  dueDate?: Date;
  /** Variabilný symbol, up to 10 digits. */
  variableSymbol?: string;
  /** Konštantný symbol, up to 4 digits. */
  constantSymbol?: string;
  /** Špecifický symbol, up to 10 digits. */
  specificSymbol?: string;
  /** Payment note for the payer's statement, up to 140 characters. */
  note?: string;
  /** Required by the 1.2.0 schema; up to 70 characters. */
  beneficiaryName?: string;
  beneficiaryAddressLine1?: string;
  beneficiaryAddressLine2?: string;
}

/** Tabs separate the fields, so a tab inside a value becomes a space (spec 3.8). */
function clean(value: string | undefined, max?: number): string {
  const v = (value ?? '').replace(/\t/g, ' ').trim();
  return max ? v.slice(0, max) : v;
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** The tab-separated field sequence (spec 3.8), before checksum and compression. */
export function payBySquareSequence(params: PayBySquareParams): string {
  const iban = params.iban?.replace(/\s+/g, '').toUpperCase();
  if (!iban) throw new Error('payBySquareSequence: "iban" is required');
  const fields = [
    '', // InvoiceID
    '1', // number of payments
    '1', // PaymentOptions: paymentorder
    params.amount != null ? params.amount.toFixed(2) : '',
    clean(params.currency ?? 'EUR').toUpperCase(),
    params.dueDate ? formatDate(params.dueDate) : '',
    clean(params.variableSymbol, 10),
    clean(params.constantSymbol, 4),
    clean(params.specificSymbol, 10),
    '', // OriginatorsReferenceInformation
    clean(params.note, 140),
    '1', // number of bank accounts
    iban,
    clean(params.bic).toUpperCase(),
    '0', // StandingOrderExt: none
    '0', // DirectDebitExt: none
    clean(params.beneficiaryName, 70),
    clean(params.beneficiaryAddressLine1, 70),
    clean(params.beneficiaryAddressLine2, 70)
  ];
  return fields.join('\t');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Raw LZMA1 stream (lc=3, lp=0, pb=2) coding every byte as a literal, so the
 * state machine never leaves state 0 and no match models are needed. No end
 * marker: the decoder knows the size from the by square header.
 */
function lzmaLiterals(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  // Range coder, as in the LZMA SDK. `low` needs 33 bits, so it is a plain number.
  let low = 0;
  let range = 0xffffffff;
  let cache = 0;
  let cacheSize = 1;
  const shiftLow = () => {
    if (low < 0xff000000 || low >= 0x100000000) {
      const carry = low >= 0x100000000 ? 1 : 0;
      let temp = cache;
      do {
        out.push((temp + carry) & 0xff);
        temp = 0xff;
      } while (--cacheSize !== 0);
      cache = Math.floor(low / 0x1000000) & 0xff;
    }
    cacheSize++;
    low = (low & 0xffffff) * 256;
  };
  const encodeBit = (probs: Uint16Array, i: number, bit: number) => {
    const p = probs[i]!;
    const bound = (range >>> 11) * p;
    if (bit === 0) {
      range = bound;
      probs[i] = p + ((2048 - p) >>> 5);
    } else {
      low += bound;
      range -= bound;
      probs[i] = p - (p >>> 5);
    }
    while (range < 0x1000000) {
      range = (range * 256) >>> 0;
      shiftLow();
    }
  };
  const isMatch = new Uint16Array(12 << 2).fill(1024);
  const literal = new Uint16Array(0x300 << 3).fill(1024);
  let prev = 0;
  data.forEach((byte, pos) => {
    encodeBit(isMatch, pos & 3, 0); // state 0, posState = pos & (2^pb - 1)
    const base = 0x300 * (prev >> 5); // lc = 3 high bits of the previous byte
    let symbol = 1;
    for (let i = 7; i >= 0; i--) {
      const bit = (byte >> i) & 1;
      encodeBit(literal, base + symbol, bit);
      symbol = (symbol << 1) | bit;
    }
    prev = byte;
  });
  for (let i = 0; i < 5; i++) shiftLow();
  return Uint8Array.from(out);
}

const BASE32HEX = '0123456789ABCDEFGHIJKLMNOPQRSTUV';

function base32hex(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = ((buffer << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32HEX[(buffer << (5 - bits)) & 31];
  return out;
}

/** The PAY by square string to render as a QR code (alphanumeric mode). */
export function generatePayBySquare(params: PayBySquareParams): string {
  const sequence = new TextEncoder().encode(payBySquareSequence(params));
  const payload = new Uint8Array(4 + sequence.length);
  new DataView(payload.buffer).setUint32(0, crc32(sequence), true);
  payload.set(sequence, 4);
  if (payload.length > 0xffff) throw new Error('generatePayBySquare: payload too large');
  const compressed = lzmaLiterals(payload);
  const bytes = new Uint8Array(4 + compressed.length);
  // Header: by square type 0 (PAY), version 0, document type 0, reserved 0.
  bytes[0] = 0x00;
  bytes[1] = 0x00;
  bytes[2] = payload.length & 0xff;
  bytes[3] = payload.length >> 8;
  bytes.set(compressed, 4);
  return base32hex(bytes);
}
