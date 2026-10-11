import { describe, expect, it } from 'vitest';
import { checkInvoiceRequirements, type InvoiceRequirementsInput } from '../invoice-requirements.js';

const base = (o: Partial<InvoiceRequirementsInput> = {}): InvoiceRequirementsInput => ({
  supplier: {
    legalName: 'Jan Novák',
    ico: '12345678',
    dic: 'CZ8001011234',
    address: { street: 'Dlouhá 1', city: 'Praha', postalCode: '11000', countryCode: 'CZ' },
    registryNote: 'Fyzická osoba zapsaná v živnostenském rejstříku'
  },
  customer: {
    legalName: 'Odběratel s.r.o.',
    dic: 'CZ12345679',
    address: { street: 'Krátká 2', city: 'Brno', postalCode: '60200', countryCode: 'CZ' }
  },
  vatPayer: true,
  taxDocument: true,
  lines: [{ description: 'Konzultace', quantity: 2 }],
  ...o
});
const codes = (o: Partial<InvoiceRequirementsInput>) => checkInvoiceRequirements(base(o)).map((i) => `${i.field}:${i.code}`);

describe('checkInvoiceRequirements', () => {
  it('passes a complete tax document', () => {
    expect(checkInvoiceRequirements(base())).toEqual([]);
  });

  it('needs the supplier DIČ only from a VAT payer on a tax document', () => {
    const supplier = { ...base().supplier, dic: undefined };
    expect(codes({ supplier })).toContain('supplier:dicMissing');
    expect(codes({ supplier, vatPayer: false })).not.toContain('supplier:dicMissing');
    expect(codes({ supplier, taxDocument: false })).not.toContain('supplier:dicMissing');
  });

  it('needs the buyer DIČ for reverse charge', () => {
    const customer = { ...base().customer!, dic: undefined };
    expect(codes({ customer, reverseCharge: true })).toContain('customer:dicMissingReverse');
    expect(codes({ customer })).toEqual([]);
  });

  it('reports a missing customer, empty lines and the register note of a non-payer', () => {
    const supplier = { ...base().supplier, registryNote: undefined, dic: undefined };
    expect(codes({ customer: undefined, lines: [], supplier, vatPayer: false })).toEqual([
      'supplier:registryMissing',
      'customer:customerMissing',
      'lines:noLines'
    ]);
  });

  it('cites the Slovak law for a Slovak supplier', () => {
    const supplier = { ...base().supplier, dic: undefined, address: { ...base().supplier.address, countryCode: 'SK' } };
    expect(checkInvoiceRequirements(base({ supplier }))[0]?.rule).toBe('§74/1 ZoDPH');
  });
});
