import { describe, expect, it } from 'vitest';
import { decode } from 'bysquare/pay';
import { generatePayBySquareString } from '../pay-by-square.js';
import { paymentQrScheme } from '../payment-qr-scheme.js';

const IBAN = 'SK9611000000002918599669';

describe('generatePayBySquareString', () => {
  // Golden strings from the bysquare repo (testdata/wire-format-test-data.ts,
  // VALID_PAYMENT_ORDER and MINIMAL_PAYMENT), produced by its reference
  // encoder for spec 1.2.0. A change in field order, tabs or header bytes
  // shows up here as a different string.
  it('matches the reference encoding of a payment order', () => {
    expect(
      generatePayBySquareString({
        iban: IBAN,
        amount: 100,
        currency: 'EUR',
        variableSymbol: '123',
        beneficiaryName: 'John Doe',
        invoiceId: 'test-001',
      }),
    ).toBe(
      '0804O0002G0L2UES834BQT9SQJQA9M5QGN1AHN4VO0KB6MVM9RPGR6APCGPRILE5PJ8VTQ52RPSLT6TCJVVC4BMR03J4998N393G7940TB936AFDVVVQCKA000',
    );
  });

  it('matches the reference encoding of a minimal payment', () => {
    expect(generatePayBySquareString({ iban: IBAN, amount: 0, beneficiaryName: 'John Doe' })).toBe(
      '0803U0008MG52E0Q0RIN3U8H327ELACLQNJDCT83GUMQUUJ31MDDAGCVPL3GO6H3J73L9584MJN1MUB510LHQUOJNQ3VVVPHEO000',
    );
  });

  it('round-trips every invoice field', () => {
    const qr = generatePayBySquareString({
      iban: 'sk96 1100 0000 0029 1859 9669',
      bic: 'tatrskbx',
      amount: 1234.565,
      currency: 'eur',
      variableSymbol: '2026-0042',
      constantSymbol: '0308',
      specificSymbol: '77',
      message: 'Faktúra 20260042',
      dueDate: new Date(Date.UTC(2026, 10, 3)),
      beneficiaryName: 'Ján Novák s.r.o.',
      beneficiaryStreet: 'Hlavná 1',
      beneficiaryCity: 'Košice',
      invoiceId: '20260042',
    });
    const model = decode(qr);
    expect(model.invoiceId).toBe('20260042');
    const payment = model.payments[0]!;
    expect(payment).toMatchObject({
      amount: 1234.57,
      currencyCode: 'EUR',
      paymentDueDate: '20261103',
      variableSymbol: '20260042',
      constantSymbol: '0308',
      specificSymbol: '77',
      // Diacritics are removed for older banking apps.
      paymentNote: 'Faktura 20260042',
      bankAccounts: [{ iban: IBAN, bic: 'TATRSKBX' }],
      beneficiary: { name: 'Jan Novak s.r.o.', street: 'Hlavna 1', city: 'Kosice' },
    });
  });

  it('leaves out an invoice number longer than the 10-character field', () => {
    const qr = generatePayBySquareString({ iban: IBAN, beneficiaryName: 'A', invoiceId: 'FV-2026-00012' });
    expect(decode(qr).invoiceId).toBeUndefined();
    const short = generatePayBySquareString({ iban: IBAN, beneficiaryName: 'A', invoiceId: '2026000012' });
    expect(decode(short).invoiceId).toBe('2026000012');
  });

  // The library's decoder reads an empty amount as 0, so compare the wire
  // strings: an empty field (the payer types the amount) must not encode as 0.
  it('leaves the amount empty when none is given', () => {
    const empty = generatePayBySquareString({ iban: IBAN, beneficiaryName: 'A' });
    const zero = generatePayBySquareString({ iban: IBAN, amount: 0, beneficiaryName: 'A' });
    expect(empty).not.toBe(zero);
  });

  // Checks the wire format without the library: base32hex → 2-byte header,
  // 2-byte little-endian length, then the LZMA stream. The first byte
  // holds bysquare type 0 and version 2 (1.2.0), the second document type 0
  // (PAY) and reserved 0.
  it('writes the PAY by square 1.2.0 header', () => {
    const qr = generatePayBySquareString({ iban: IBAN, amount: 10, beneficiaryName: 'A' });
    const bytes = base32hexDecode(qr);
    expect(bytes[0]).toBe(0x02);
    expect(bytes[1]).toBe(0x00);
  });

  it('defaults the currency to EUR', () => {
    const qr = generatePayBySquareString({ iban: IBAN, amount: 10, beneficiaryName: 'A' });
    expect(decode(qr).payments[0]!.currencyCode).toBe('EUR');
  });

  it('rejects an invalid IBAN and a missing beneficiary', () => {
    expect(() => generatePayBySquareString({ iban: 'SK00 1234', beneficiaryName: 'A' })).toThrow();
    expect(() => generatePayBySquareString({ iban: '', beneficiaryName: 'A' })).toThrow(/iban/);
    expect(() => generatePayBySquareString({ iban: IBAN, beneficiaryName: '  ' })).toThrow(/beneficiaryName/);
  });

  // Strings made by other generators (bysquare repo, testdata decode
  // vectors, spec 1.0.0). They prove the decoder used in the round-trip
  // tests agrees with third-party encoders.
  it('decodes strings from other generators', () => {
    const a = decode(
      '0004I0006UC5LT8E21H3IC1K9R40P82GJL22NTU0586BBEOEKDMQSVUUBAOP1C0FFE14UJA1F1LJMV0FONE35J05TRC77FTIMV87NKNANNOFJB684000',
    );
    expect(a.invoiceId).toBe('2015001');
    expect(a.payments[0]).toMatchObject({ amount: 25.3, currencyCode: 'EUR' });
    expect(a.payments[0]!.bankAccounts[0]!.iban).toBe('SK4523585719461382368397');
  });
});

describe('paymentQrScheme', () => {
  it('uses PAY by square for a Slovak payee account', () => {
    expect(paymentQrScheme({ payeeIban: 'sk96 1100 0000 0029 1859 9669', currency: 'EUR' })).toBe('pay_by_square');
    // Even for CZK and a Czech buyer: a Slovak account means a Slovak transfer.
    expect(paymentQrScheme({ payeeIban: IBAN, currency: 'CZK', buyerCountry: 'CZ' })).toBe('pay_by_square');
  });

  it('uses PAY by square for an EUR invoice to a Slovak buyer', () => {
    expect(paymentQrScheme({ payeeIban: 'CZ6508000000192000145399', currency: 'eur', buyerCountry: 'sk' })).toBe(
      'pay_by_square',
    );
  });

  it('keeps SPAYD for everything else', () => {
    const cz = 'CZ6508000000192000145399';
    expect(paymentQrScheme({ payeeIban: cz, currency: 'CZK', buyerCountry: 'SK' })).toBe('spayd');
    expect(paymentQrScheme({ payeeIban: cz, currency: 'EUR', buyerCountry: 'CZ' })).toBe('spayd');
    expect(paymentQrScheme({ payeeIban: cz, currency: 'EUR', buyerCountry: 'DE' })).toBe('spayd');
    expect(paymentQrScheme({ payeeIban: cz, currency: 'EUR', buyerCountry: null })).toBe('spayd');
    expect(paymentQrScheme({ payeeIban: cz, currency: 'CZK' })).toBe('spayd');
  });
});

function base32hexDecode(input: string): Uint8Array {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of input) {
    buffer = (buffer << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
