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

describe('checkInvoiceRequirements per VAT status and buyer', () => {
  const addr = (countryCode: string, street = 'Main St 1') => ({ street, city: 'City', postalCode: '1000', countryCode });
  const empty = (countryCode: string) => ({ street: '', city: '', postalCode: '', countryCode });
  type Buyer = NonNullable<InvoiceRequirementsInput['customer']>;
  const buyers: Record<string, Buyer> = {
    cz: { legalName: 'Odběratel s.r.o.', ico: '12345679', dic: 'CZ12345679', address: addr('CZ') },
    eu: { legalName: 'Kunde GmbH', dic: 'DE123456789', address: addr('DE') },
    uk: { legalName: 'Client Ltd', dic: 'GB123456789', address: addr('GB') },
    person: { legalName: 'Jana Nováková', isPerson: true, address: addr('CZ') }
  };
  const show = (r: ReturnType<typeof checkInvoiceRequirements>) =>
    r.map((i) => `${i.field}:${i.code}${i.rule ? `@${i.rule}` : ''}:${i.severity}`);
  const run = (vatStatus: 'payer' | 'identified' | 'non_payer', customer: Buyer | undefined, o: Partial<InvoiceRequirementsInput> = {}) =>
    show(checkInvoiceRequirements(base({ vatStatus, vatPayer: undefined, customer, ...o })));
  const emailStreet = (b: Buyer): Buyer => ({ ...b, address: { ...b.address, street: 'buyer@example.com' } });
  const noAddr = (b: Buyer): Buyer => ({ ...b, address: empty(b.address.countryCode) });

  it('payer: §29 ZDPH for every buyer, an e-mail in the street is not a seat', () => {
    for (const b of Object.values(buyers)) expect(run('payer', b)).toEqual([]);
    expect(run('payer', emailStreet(buyers.uk!))).toEqual(['customer:addressIncomplete@§29/1 ZDPH:error']);
    expect(run('payer', noAddr(buyers.cz!))).toEqual(['customer:addressIncomplete@§29/1 ZDPH:error']);
    expect(run('payer', noAddr(buyers.cz!), { taxDocument: false })).toEqual(['customer:addressIncomplete@§29/1 ZDPH:warning']);
  });

  it('identified person: an EU business needs name, seat and VAT ID under §29 ZDPH', () => {
    expect(run('identified', buyers.eu)).toEqual([]);
    expect(run('identified', emailStreet(buyers.eu!))).toEqual(['customer:addressIncomplete@§29/4 ZDPH:error']);
    expect(run('identified', { ...noAddr(buyers.eu!), dic: undefined, ico: 'HRB1', legalName: ' ' })).toEqual([
      'customer:nameMissing@§29/1c ZDPH:error',
      'customer:addressIncomplete@§29/4 ZDPH:error',
      'customer:dicMissingReverse@§29/1d ZDPH:error'
    ]);
    const supplier = { ...base().supplier, dic: undefined };
    expect(run('identified', buyers.eu, { supplier })).toEqual(['supplier:dicMissing@§29/1b ZDPH:error']);
    expect(run('identified', buyers.eu, { lines: [] })).toEqual(['lines:noLines@§29/1f ZDPH:error']);
  });

  it('identified person: no VAT rules for a CZ business, UK business, private person, or a pro forma', () => {
    for (const b of [buyers.cz!, buyers.uk!, buyers.person!]) {
      expect(run('identified', noAddr(b))).toEqual([]);
      expect(run('identified', emailStreet(b))).toEqual([]);
    }
    expect(run('identified', noAddr(buyers.eu!), { taxDocument: false })).toEqual([]);
    expect(run('identified', buyers.uk, { supplier: { ...base().supplier, dic: undefined } })).toEqual([]);
  });

  it('non-payer: never flags the buyer address or VAT ID; supplier rules from §435 OZ stay', () => {
    for (const b of Object.values(buyers)) {
      expect(run('non_payer', noAddr(b))).toEqual([]);
      expect(run('non_payer', { ...emailStreet(b), dic: undefined }, { reverseCharge: true })).toEqual([]);
    }
    const supplier = { ...base().supplier, legalName: '', dic: undefined, registryNote: undefined, address: empty('CZ') };
    expect(run('non_payer', buyers.eu, { supplier, lines: [{ description: '', quantity: 1 }] })).toEqual([
      'supplier:nameMissing@§435 OZ:error',
      'supplier:addressIncomplete@§435 OZ:error',
      'supplier:registryMissing@§435 OZ:warning',
      'lines:lineNameMissing:warning'
    ]);
    expect(run('non_payer', undefined, { lines: [] })).toEqual(['customer:customerMissing:warning', 'lines:noLines:error']);
  });

  it('guesses a private person from missing IČO and DIČ, unless flagged as a business', () => {
    const anon: Buyer = { legalName: 'Hans', address: empty('DE') };
    expect(run('identified', anon)).toEqual([]);
    expect(run('identified', { ...anon, isPerson: false })).toEqual([
      'customer:addressIncomplete@§29/4 ZDPH:error',
      'customer:dicMissingReverse@§29/1d ZDPH:error'
    ]);
  });

  it('Slovak §7a registrant cites §74 ZoDPH; the legacy vatPayer flag still works', () => {
    const supplier = { ...base().supplier, address: { ...base().supplier.address, countryCode: 'SK' } };
    const czBuyer = noAddr(buyers.cz!);
    expect(run('identified', { ...czBuyer, address: empty('SK') }, { supplier })).toEqual([]);
    expect(run('identified', noAddr(buyers.eu!), { supplier })).toEqual(['customer:addressIncomplete@§74 ZoDPH:error']);
    expect(show(checkInvoiceRequirements(base({ customer: czBuyer })))).toEqual(['customer:addressIncomplete@§29/1 ZDPH:error']);
    expect(show(checkInvoiceRequirements(base({ vatPayer: false, customer: czBuyer })))).toEqual([]);
  });
});
