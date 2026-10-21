import { describe, expect, it } from 'vitest';
import {
  CA,
  caFederalDeadlines,
  caFederalHolidays,
  caInvoiceFields,
  validateBusinessNumber,
  validateCaBankAccount,
  validateCaRoutingNumber,
  validateProgramAccount,
  validateQstNumber,
} from '../countries/ca/index.js';
import { countryPackProblems } from '../countries/contract.js';

describe('CA country pack', () => {
  it('passes the contract checks', () => {
    expect(countryPackProblems(CA)).toEqual([]);
  });

  it('lists all 13 provinces and territories', () => {
    expect(CA.subdivisions).toHaveLength(13);
  });

  it('has the current HST, QST and PST rates per province', () => {
    const current = (sub: string) =>
      CA.indirectTax.rateSets.filter((s) => s.subdivision === sub).at(-1)?.rates[0]?.rate;
    expect(current('CA-ON')).toBe(13);
    expect(current('CA-NS')).toBe(14);
    expect(current('CA-NB')).toBe(15);
    expect(current('CA-NL')).toBe(15);
    expect(current('CA-PE')).toBe(15);
    expect(current('CA-QC')).toBe(9.975);
    expect(current('CA-BC')).toBe(7);
    expect(current('CA-SK')).toBe(6);
    expect(current('CA-MB')).toBe(7);
    expect(current('CA-AB')).toBeUndefined();
  });

  it('keeps Nova Scotia at 15 % before 1 April 2025', () => {
    const ns = CA.indirectTax.rateSets.filter((s) => s.subdivision === 'CA-NS');
    expect(ns.map((s) => [s.validFrom, s.rates[0]?.rate])).toEqual([
      ['2010-07-01', 15],
      ['2025-04-01', 14],
    ]);
  });
});

describe('CA tax IDs', () => {
  it('validates the Business Number check digit', () => {
    expect(validateBusinessNumber('123456782')).toBe(true);
    expect(validateBusinessNumber('123 456 782')).toBe(true);
    expect(validateBusinessNumber('123456789')).toBe(false);
    expect(validateBusinessNumber('12345678')).toBe(false);
    expect(validateBusinessNumber('000000000')).toBe(false);
  });

  it('validates the GST/HST program account', () => {
    expect(validateProgramAccount('123456782 RT 0001', 'RT')).toBe(true);
    expect(validateProgramAccount('123456782rt0001', 'RT')).toBe(true);
    expect(validateProgramAccount('123456782RP0001', 'RT')).toBe(false);
    expect(validateProgramAccount('123456782RT0000', 'RT')).toBe(false);
    expect(validateProgramAccount('123456789RT0001', 'RT')).toBe(false);
  });

  it('checks the QST number shape', () => {
    expect(validateQstNumber('1234567890 TQ 0001')).toBe(true);
    expect(validateQstNumber('1234567890RT0001')).toBe(false);
    expect(validateQstNumber('123456789TQ0001')).toBe(false);
  });
});

describe('CA invoice tiers (SOR/91-45 s. 3)', () => {
  it('needs only name, date and total below CAD 100', () => {
    expect(caInvoiceFields(99.99)).toEqual({ fields: ['supplier_name', 'issue_date', 'total_with_tax'], paymentTerms: false });
  });

  it('adds the GST/HST number and tax from CAD 100', () => {
    const { fields, paymentTerms } = caInvoiceFields(100);
    expect(fields).toContain('supplier_vat_id');
    expect(fields).toContain('tax_amount_per_rate');
    expect(fields).not.toContain('customer_name');
    expect(paymentTerms).toBe(false);
    expect(caInvoiceFields(499.99).fields).not.toContain('customer_name');
  });

  it('adds customer, description and payment terms from CAD 500', () => {
    const { fields, paymentTerms } = caInvoiceFields(500);
    expect(fields).toContain('customer_name');
    expect(fields).toContain('line_description');
    expect(paymentTerms).toBe(true);
  });

  it('uses CAD 100 as the simplified threshold', () => {
    expect(CA.invoice.simplifiedThreshold).toEqual({ amount: 100, currency: 'CAD' });
  });
});

describe('CA holidays and deadlines', () => {
  it('lists the 2026 federal holidays', () => {
    expect(caFederalHolidays(2026)).toEqual([
      '2026-01-01',
      '2026-04-03', // Good Friday
      '2026-05-18', // Victoria Day: 25 May is a Monday, so the one before
      '2026-07-01',
      '2026-08-03', // Civic Holiday
      '2026-09-07', // Labour Day
      '2026-09-30', // Truth and Reconciliation
      '2026-10-12', // Thanksgiving
      '2026-11-11',
      '2026-12-25',
      '2026-12-26',
    ]);
  });

  it('moves Canada Day to 2 July when 1 July is a Sunday', () => {
    expect(caFederalHolidays(2029)).toContain('2029-07-02');
    expect(caFederalHolidays(2029)).not.toContain('2029-07-01');
  });

  it('has no Truth and Reconciliation day before 2021', () => {
    expect(caFederalHolidays(2020)).not.toContain('2020-09-30');
  });

  it('shifts deadlines on a weekend to the next business day', () => {
    const d = caFederalDeadlines(2026);
    // 15 June 2026 is a Monday; 30 April 2026 a Thursday; 31 January 2026 a Saturday.
    expect(d.find((x) => x.kind === 'income_tax_t1_self_employed')?.date).toBe('2026-06-15');
    expect(d.find((x) => x.kind === 'income_tax_t1')?.date).toBe('2026-04-30');
    expect(d.find((x) => x.kind === 'gst_hst_return_quarterly')?.date).toBe('2026-02-02');
    expect(d.filter((x) => x.kind === 'gst_hst_return_monthly')).toHaveLength(12);
  });
});

describe('CA bank accounts', () => {
  it('accepts transit-institution-account', () => {
    expect(validateCaBankAccount('12345-001-1234567')).toBe(true);
    expect(validateCaBankAccount('123450011234567')).toBe(true);
    expect(validateCaBankAccount('12345-001-123456')).toBe(false);
    expect(validateCaBankAccount('00000-001-1234567')).toBe(false);
  });

  it('accepts the EFT routing number form', () => {
    expect(validateCaRoutingNumber('000112345')).toBe(true);
    expect(validateCaRoutingNumber('100112345')).toBe(false);
  });
});
