import { describe, expect, it } from 'vitest';
import { skEInvoiceDeadlineDays, skEInvoiceScope, type SkEInvoiceInput } from '../sk-einvoicing.js';

const base: SkEInvoiceInput = {
  supplierCountry: 'SK',
  supplierVatStatus: 'payer',
  customer: { ico: '87654321', dic: 'SK2020654321', address: { countryCode: 'SK' } },
  documentType: 'invoice',
  supplyDate: '2027-01-01'
};
const scope = (overrides: Partial<SkEInvoiceInput>) => skEInvoiceScope({ ...base, ...overrides });

describe('skEInvoiceScope', () => {
  it('makes a domestic B2B invoice from a VAT payer mandatory from 1 January 2027', () => {
    expect(scope({})).toEqual({ scope: 'mandatory', reason: 'in_scope' });
    expect(scope({ documentType: 'credit_note' }).scope).toBe('mandatory');
    expect(scope({ supplyDate: '2026-12-31' })).toEqual({ scope: 'voluntary', reason: 'before_start' });
  });

  it('covers a buyer that is a non-VAT payer or a public body with only an IČO', () => {
    expect(scope({ customer: { dic: '1020304050', address: { countryCode: 'SK' } } }).scope).toBe('mandatory');
    expect(scope({ customer: { ico: '00603481', address: { countryCode: 'SK' } } }).scope).toBe('mandatory');
  });

  it('leaves non-payers, exempt and eKasa-documented supplies voluntary', () => {
    expect(scope({ supplierVatStatus: 'non_payer' }).reason).toBe('supplier_not_vat_payer');
    expect(scope({ supplierVatStatus: 'identified' }).reason).toBe('supplier_not_vat_payer');
    expect(scope({ exempt: true }).reason).toBe('exempt_supply');
    expect(scope({ simplified: true }).reason).toBe('simplified');
  });

  it('does not apply to B2C, foreign buyers, Czech suppliers or proformas', () => {
    expect(scope({ customer: { isPerson: true, address: { countryCode: 'SK' } } }).reason).toBe('buyer_person');
    expect(scope({ customer: undefined }).reason).toBe('buyer_person');
    expect(scope({ customer: { dic: 'CZ12345678', address: { countryCode: 'CZ' } } }).reason).toBe('buyer_not_domestic');
    expect(scope({ supplierCountry: 'CZ', customer: { dic: 'CZ12345678', address: { countryCode: 'CZ' } } }).reason).toBe('supplier_not_sk');
    expect(scope({ documentType: 'proforma' }).reason).toBe('not_tax_document');
  });
});

describe('skEInvoiceDeadlineDays', () => {
  it('is 15 days until 30 June 2030 and 10 days from 1 July 2030', () => {
    expect(skEInvoiceDeadlineDays('2027-01-01')).toBe(15);
    expect(skEInvoiceDeadlineDays('2030-06-30')).toBe(15);
    expect(skEInvoiceDeadlineDays('2030-07-01')).toBe(10);
  });
});
