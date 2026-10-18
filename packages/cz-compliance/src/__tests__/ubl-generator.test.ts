import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import type { IsdocInvoiceInput } from '../isdoc-generator.js';
import { generateUblInvoiceXml, PEPPOL_CUSTOMIZATION_ID, ublUnitCode, validatePeppolInvoice } from '../ubl-generator.js';

function invoice(overrides: Partial<IsdocInvoiceInput> = {}): IsdocInvoiceInput {
  return {
    invoiceNumber: '2027001',
    variableSymbol: '2027001',
    issueDate: '2027-01-15',
    dueDate: '2027-01-29',
    taxableSupplyDate: '2027-01-15',
    currency: 'EUR',
    supplier: {
      legalName: 'Dodávateľ s.r.o.',
      ico: '12345678',
      dic: 'SK2020123456',
      isVatPayer: true,
      address: { street: 'Hlavná 1', city: 'Bratislava', postalCode: '81101', countryCode: 'SK' },
      email: 'fakturacia@dodavatel.sk'
    },
    customer: {
      legalName: 'Odberateľ & syn a.s.',
      ico: '87654321',
      dic: 'SK2020654321',
      isVatPayer: true,
      address: { street: 'Nová 5', city: 'Košice', postalCode: '04001', countryCode: 'SK' }
    },
    lineItems: [
      { description: 'Konzultácia', quantity: 3, unit: 'hod', unitPriceWithoutVat: 60, vatRate: 'base', vatRatePercent: 23 },
      { description: 'Kniha', quantity: 2, unit: 'ks', unitPriceWithoutVat: 10.5, vatRate: 'reduced', vatRatePercent: 5 }
    ],
    totals: {
      totalWithoutVat: 201,
      totalVat: 42.45,
      totalWithVat: 243.45,
      vatRecapitulation: []
    },
    bankAccount: { iban: 'SK31 1200 0000 1987 4263 7541', bic: 'TATRSKBX' },
    ...overrides
  };
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false });

describe('generateUblInvoiceXml', () => {
  it('produces well-formed Peppol BIS 3.0 XML with consistent totals', () => {
    const xml = generateUblInvoiceXml(invoice());
    expect(XMLValidator.validate(xml)).toBe(true);
    const doc = parser.parse(xml).Invoice;
    expect(doc['cbc:CustomizationID']).toBe(PEPPOL_CUSTOMIZATION_ID);
    expect(doc['cbc:InvoiceTypeCode']).toBe('380');
    const totals = doc['cac:LegalMonetaryTotal'];
    expect(totals['cbc:LineExtensionAmount']['#text']).toBe('201.00');
    expect(totals['cbc:TaxInclusiveAmount']['#text']).toBe('243.45');
    // 180 × 23 % + 21 × 5 % = 41.40 + 1.05; matches the caller's total, so no rounding line.
    expect(totals['cbc:PayableRoundingAmount']).toBeUndefined();
    expect(doc['cac:TaxTotal']['cbc:TaxAmount']['#text']).toBe('42.45');
    expect(doc['cac:TaxTotal']['cac:TaxSubtotal']).toHaveLength(2);
    expect(doc['cac:PaymentMeans']['cbc:PaymentMeansCode']).toBe('58');
    expect(doc['cac:PaymentMeans']['cac:PayeeFinancialAccount']['cbc:ID']).toBe('SK3112000000198742637541');
  });

  it('sets Peppol endpoints from VAT numbers and escapes text', () => {
    const xml = generateUblInvoiceXml(invoice());
    const doc = parser.parse(xml).Invoice;
    const supplier = doc['cac:AccountingSupplierParty']['cac:Party'];
    expect(supplier['cbc:EndpointID']).toEqual({ '#text': 'SK2020123456', '@schemeID': '9950' });
    expect(xml).toContain('Odberateľ &amp; syn a.s.');
  });

  it('puts the buyer contact person into AccountingCustomerParty/Party/Contact/Name', () => {
    const base = invoice();
    const xml = generateUblInvoiceXml(invoice({ customer: { ...base.customer, contactName: 'Ján Kováč', email: 'jan@odberatel.sk' } }));
    expect(XMLValidator.validate(xml)).toBe(true);
    const contact = parser.parse(xml).Invoice['cac:AccountingCustomerParty']['cac:Party']['cac:Contact'];
    expect(contact).toEqual({ 'cbc:Name': 'Ján Kováč', 'cbc:ElectronicMail': 'jan@odberatel.sk' });
    expect(xml).toContain('<cac:Contact><cbc:Name>Ján Kováč</cbc:Name><cbc:ElectronicMail>');
    const plain = parser.parse(generateUblInvoiceXml(base)).Invoice['cac:AccountingCustomerParty']['cac:Party'];
    expect(plain['cac:Contact']).toBeUndefined();
  });

  it('maps a non-VAT payer to category O without any VAT identifiers', () => {
    const xml = generateUblInvoiceXml(
      invoice({
        supplier: { ...invoice().supplier, isVatPayer: false, dic: undefined },
        lineItems: [{ description: 'Služba', quantity: 1, unitPriceWithoutVat: 100, vatRate: 'zero', vatRatePercent: 0 }],
        totals: { totalWithoutVat: 100, totalVat: 0, totalWithVat: 100, vatRecapitulation: [] }
      })
    );
    const doc = parser.parse(xml).Invoice;
    expect(doc['cac:TaxTotal']['cac:TaxSubtotal']['cac:TaxCategory']['cbc:ID']).toBe('O');
    expect(xml).not.toContain('PartyTaxScheme');
    expect(xml).not.toContain('cbc:Percent');
  });

  it('uses category AE for reverse charge and reports cash rounding and prepayments', () => {
    const xml = generateUblInvoiceXml(
      invoice({
        lineItems: [{ description: 'Stavebné práce', quantity: 1, unitPriceWithoutVat: 99.6, vatRate: 'base', vatRatePercent: 23 }],
        totals: { totalWithoutVat: 99.6, totalVat: 0, totalWithVat: 100, vatRecapitulation: [] }
      }),
      { reverseCharge: true, prepaidAmount: 50 }
    );
    const doc = parser.parse(xml).Invoice;
    const sub = doc['cac:TaxTotal']['cac:TaxSubtotal'];
    expect(sub['cac:TaxCategory']['cbc:ID']).toBe('AE');
    expect(sub['cac:TaxCategory']['cbc:TaxExemptionReason']).toBe('Reverse charge');
    const totals = doc['cac:LegalMonetaryTotal'];
    expect(totals['cbc:PayableRoundingAmount']['#text']).toBe('0.40');
    expect(totals['cbc:PrepaidAmount']['#text']).toBe('50.00');
    expect(totals['cbc:PayableAmount']['#text']).toBe('50.00');
  });

  it('maps Czech and Slovak units to UN/ECE codes', () => {
    expect(ublUnitCode('ks')).toBe('H87');
    expect(ublUnitCode('hod.')).toBe('HUR');
    expect(ublUnitCode('m²')).toBe('MTK');
    expect(ublUnitCode('balík')).toBe('C62');
  });

  it('rejects an invoice without lines', () => {
    expect(() => generateUblInvoiceXml(invoice({ lineItems: [] }))).toThrow(/line item/);
  });
});

describe('validatePeppolInvoice', () => {
  const rules = (input: IsdocInvoiceInput, reverseCharge = false) => validatePeppolInvoice(input, { reverseCharge }).map((i) => i.rule);

  it('passes a complete invoice', () => {
    expect(validatePeppolInvoice(invoice())).toEqual([]);
  });

  it('needs an electronic address for a buyer without a VAT number', () => {
    const base = invoice();
    expect(rules(invoice({ customer: { ...base.customer, dic: undefined } }))).toEqual(['PEPPOL-EN16931-R010']);
  });

  it('needs both VAT numbers for reverse charge', () => {
    const base = invoice();
    expect(rules(invoice({ customer: { ...base.customer, dic: undefined } }), true)).toContain('BR-AE-02');
  });

  it('flags a missing seller VAT number on a VAT invoice, but not for a non-payer', () => {
    const base = invoice();
    expect(rules(invoice({ supplier: { ...base.supplier, dic: undefined } }))).toContain('BR-S-02');
    expect(rules(invoice({ supplier: { ...base.supplier, dic: undefined, isVatPayer: false } }))).not.toContain('BR-S-02');
  });

  it('reports missing names, countries and items, and warns about a missing IBAN', () => {
    const base = invoice();
    const issues = validatePeppolInvoice(
      invoice({
        customer: { ...base.customer, legalName: ' ', address: { ...base.customer.address, countryCode: '' } },
        lineItems: [],
        bankAccount: { accountNumber: '123456789/0800' }
      })
    );
    expect(issues.map((i) => i.rule)).toEqual(expect.arrayContaining(['BR-07', 'BR-11', 'BR-16', 'BR-61']));
    expect(issues.find((i) => i.rule === 'BR-61')?.severity).toBe('warning');
  });
});
