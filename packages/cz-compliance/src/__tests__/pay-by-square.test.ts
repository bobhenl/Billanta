import { describe, expect, it } from 'vitest';
import { crc32, generatePayBySquare, payBySquareSequence } from '../pay-by-square.js';

describe('payBySquareSequence', () => {
  it('orders the fields as the 1.2.0 schema does', () => {
    expect(payBySquareSequence({ iban: 'SK96 1100 0000 0029 1859 9669', amount: 100, variableSymbol: '123', beneficiaryName: 'Test' })).toBe(
      '\t1\t1\t100.00\tEUR\t\t123\t\t\t\t\t1\tSK9611000000002918599669\t\t0\t0\tTest\t\t'
    );
  });

  it('formats the due date as YYYYMMDD and keeps tabs out of values', () => {
    const seq = payBySquareSequence({ iban: 'SK9611000000002918599669', dueDate: new Date(Date.UTC(2026, 9, 31)), note: 'a\tb' });
    expect(seq.split('\t')[5]).toBe('20261031');
    expect(seq.split('\t')[10]).toBe('a b');
  });

  it('leaves the amount empty when none is given', () => {
    expect(payBySquareSequence({ iban: 'SK9611000000002918599669' }).split('\t')[3]).toBe('');
  });

  it('requires an IBAN', () => {
    expect(() => payBySquareSequence({ iban: ' ' })).toThrow();
  });
});

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('generatePayBySquare', () => {
  // Decoded independently (Python lzma, raw LZMA1 lc=3 lp=0 pb=2) with a matching CRC32.
  it('produces a stream a standard LZMA decoder reads', () => {
    expect(generatePayBySquare({ iban: 'SK9611000000002918599669', amount: 100, variableSymbol: '123', beneficiaryName: 'Test' })).toBe(
      '000460009M685BQLP2OR1CFEA27OC3N5PKE4HJGDV0NDCACG86PCQNM6P9DPV0EUK20S3SPB8CNKRQ25733S911LN3A1HC9O4A0TSM50CDETUL875KLG'
    );
  });

  it('starts with the PAY header and the uncompressed size', () => {
    // Header 0x0000, then 0x43 0x00 = 67 bytes (4 CRC + 63 data), in base32hex.
    expect(generatePayBySquare({ iban: 'SK9611000000002918599669', amount: 100, variableSymbol: '123', beneficiaryName: 'Test' }).slice(0, 6)).toBe('000460');
  });

  it('stays within the QR alphanumeric charset', () => {
    const s = generatePayBySquare({ iban: 'SK9611000000002918599669', amount: 1234.5, note: 'Faktúra 2026001 – Šťastný kôň', beneficiaryName: 'Billanta s.r.o.' });
    expect(s).toMatch(/^[0-9A-V]+$/);
  });
});
