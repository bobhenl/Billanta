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

  it('addresses Slovak parties as 0245:DIČ and keeps the IČ DPH in PartyTaxScheme', () => {
    const xml = generateUblInvoiceXml(invoice());
    const doc = parser.parse(xml).Invoice;
    const supplier = doc['cac:AccountingSupplierParty']['cac:Party'];
    expect(supplier['cbc:EndpointID']).toEqual({ '#text': '2020123456', '@schemeID': '0245' });
    expect(supplier['cac:PartyTaxScheme']['cbc:CompanyID']).toBe('SK2020123456');
    expect(doc['cac:AccountingCustomerParty']['cac:Party']['cbc:EndpointID']).toEqual({ '#text': '2020654321', '@schemeID': '0245' });
    expect(xml).toContain('Odberateľ &amp; syn a.s.');
  });

  it('reaches a Slovak non-VAT-payer buyer by its bare DIČ without inventing an IČ DPH', () => {
    const base = invoice();
    const xml = generateUblInvoiceXml(invoice({ customer: { ...base.customer, dic: '1020304050', isVatPayer: false } }));
    const buyer = parser.parse(xml).Invoice['cac:AccountingCustomerParty']['cac:Party'];
    expect(buyer['cbc:EndpointID']).toEqual({ '#text': '1020304050', '@schemeID': '0245' });
    expect(buyer['cac:PartyTaxScheme']).toBeUndefined();
  });

  it('keeps VAT-number endpoints for other countries', () => {
    const base = invoice();
    const xml = generateUblInvoiceXml(
      invoice({ customer: { ...base.customer, dic: 'CZ12345678', address: { ...base.customer.address, countryCode: 'CZ' } } })
    );
    const buyer = parser.parse(xml).Invoice['cac:AccountingCustomerParty']['cac:Party'];
    expect(buyer['cbc:EndpointID']).toEqual({ '#text': 'CZ12345678', '@schemeID': '9929' });
  });

  it('references the corrected invoice (BT-25, BT-26) on an invoice', () => {
    const xml = generateUblInvoiceXml(invoice(), { precedingInvoice: { number: '2026999', issueDate: '2026-12-20' } });
    expect(XMLValidator.validate(xml)).toBe(true);
    const ref = parser.parse(xml).Invoice['cac:BillingReference']['cac:InvoiceDocumentReference'];
    expect(ref).toEqual({ 'cbc:ID': '2026999', 'cbc:IssueDate': '2026-12-20' });
  });

  it('writes a credit note as a UBL CreditNote with positive amounts and the original invoice', () => {
    const base = invoice();
    const xml = generateUblInvoiceXml(
      invoice({
        invoiceNumber: 'D2027001',
        lineItems: base.lineItems.map((l) => ({ ...l, quantity: -l.quantity })),
        totals: { ...base.totals, totalWithoutVat: -201, totalVat: -42.45, totalWithVat: -243.45 }
      }),
      { documentType: 'credit_note', precedingInvoice: { number: '2027001', issueDate: '2027-01-15' } }
    );
    expect(XMLValidator.validate(xml)).toBe(true);
    const parsed = parser.parse(xml);
    expect(parsed.Invoice).toBeUndefined();
    const doc = parsed.CreditNote;
    expect(doc['@xmlns']).toBe('urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2');
    expect(doc['cbc:CreditNoteTypeCode']).toBe('381');
    expect(doc['cbc:DueDate']).toBeUndefined();
    expect(doc['cac:PaymentMeans']['cbc:PaymentDueDate']).toBe('2027-01-29');
    expect(doc['cac:BillingReference']['cac:InvoiceDocumentReference']['cbc:ID']).toBe('2027001');
    expect(doc['cac:CreditNoteLine'][0]['cbc:CreditedQuantity']).toEqual({ '#text': '3', '@unitCode': 'HUR' });
    const totals = doc['cac:LegalMonetaryTotal'];
    expect(totals['cbc:PayableAmount']['#text']).toBe('243.45');
    expect(totals['cbc:PayableRoundingAmount']).toBeUndefined();
    // UBL 2.1 CreditNote order: TaxPointDate comes before the type code.
    expect(xml.indexOf('<cbc:TaxPointDate>')).toBeLessThan(xml.indexOf('<cbc:CreditNoteTypeCode>'));
    expect(xml.indexOf('<cac:BillingReference>')).toBeGreaterThan(xml.indexOf('<cbc:BuyerReference>'));
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

  it('needs a 10-digit DIČ as the electronic address of a Slovak buyer', () => {
    const base = invoice();
    const issues = validatePeppolInvoice(invoice({ customer: { ...base.customer, dic: undefined } }));
    expect(issues).toEqual([{ rule: 'PEPPOL-EN16931-R010', field: 'customer', code: 'skDicMissing', severity: 'error' }]);
    expect(rules(invoice({ customer: { ...base.customer, dic: '12345' } }))).toContain('PEPPOL-EN16931-R010');
  });

  it('needs a VAT number as the electronic address of a buyer elsewhere', () => {
    const base = invoice();
    const issues = validatePeppolInvoice(
      invoice({ customer: { ...base.customer, dic: undefined, address: { ...base.customer.address, countryCode: 'AT' } } })
    );
    expect(issues.map((i) => i.code)).toEqual(['endpointMissing']);
  });

  it('wants the original invoice on a credit note', () => {
    expect(validatePeppolInvoice(invoice(), { documentType: 'credit_note' }).map((i) => i.rule)).toEqual(['BT-25']);
    expect(validatePeppolInvoice(invoice(), { documentType: 'credit_note', precedingInvoice: { number: '1' } })).toEqual([]);
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
