import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_COUNTRIES,
  CHECKLIST_CUSTOMERS,
  CHECKLIST_DOCUMENTS,
  invoiceChecklist,
  normalizeScenario,
  type ChecklistItemId,
  type ChecklistScenario
} from '../invoice-checklist.js';
import { lawUrl } from '../law-links.js';
import { VAT_STATUSES } from '../vat-status.js';

const base: ChecklistScenario = { country: 'CZ', vatStatus: 'payer', document: 'invoice', customer: 'business', reverseCharge: false };
const list = (over: Partial<ChecklistScenario> = {}) => invoiceChecklist({ ...base, ...over });
const ids = (over: Partial<ChecklistScenario> = {}) => list(over).items.map((i) => i.id);
const item = (id: ChecklistItemId, over: Partial<ChecklistScenario> = {}) => list(over).items.find((i) => i.id === id);

const ALL: ChecklistScenario[] = CHECKLIST_COUNTRIES.flatMap((country) =>
  VAT_STATUSES.flatMap((vatStatus) =>
    CHECKLIST_DOCUMENTS.flatMap((document) =>
      CHECKLIST_CUSTOMERS.flatMap((customer) => [false, true].map((reverseCharge) => ({ country, vatStatus, document, customer, reverseCharge })))
    )
  )
);

describe('invoiceChecklist – every scenario', () => {
  it('cites only rules that resolve to a law link, and the right country’s laws', () => {
    for (const s of ALL) {
      for (const i of invoiceChecklist(s).items) {
        if (!i.rule) continue;
        expect(lawUrl(i.rule), `${JSON.stringify(s)} ${i.id} ${i.rule}`).not.toBeNull();
        if (s.country === 'SK') expect(i.rule).toMatch(/ZoDPH|ObZ$/);
        else expect(i.rule).toMatch(/ZDPH|OZ$/);
      }
    }
  });

  it('never lists an item twice and always asks for the supplier’s name and address', () => {
    for (const s of ALL) {
      const items = invoiceChecklist(s).items.map((i) => i.id);
      expect(new Set(items).size, JSON.stringify(s)).toBe(items.length);
      expect(items).toContain('supplierName');
      expect(items).toContain('supplierAddress');
    }
  });

  it('labels items without a legal basis as recommended, never as required', () => {
    for (const s of ALL) for (const i of invoiceChecklist(s).items) if (!i.rule) expect(i.level).toBe('recommended');
  });
});

describe('invoiceChecklist – CZ VAT payer (§29 ZDPH)', () => {
  it('lists the §29/1 letters for an ordinary domestic B2B invoice', () => {
    const c = list();
    expect(c.taxDocument).toBe(true);
    expect(item('supplierName')?.rule).toBe('§29/1a ZDPH');
    expect(item('supplierDic')).toMatchObject({ level: 'required', rule: '§29/1b ZDPH' });
    expect(item('customerName')?.rule).toBe('§29/1c ZDPH');
    expect(item('customerDic')).toMatchObject({ level: 'conditional', rule: '§29/1d ZDPH', note: 'ifBuyerHasDic' });
    expect(item('number')?.rule).toBe('§29/1e ZDPH');
    expect(item('subject')?.rule).toBe('§29/1f ZDPH');
    expect(item('issueDate')?.rule).toBe('§29/1g ZDPH');
    expect(item('taxPointDate')).toMatchObject({ level: 'conditional', rule: '§29/1h ZDPH', note: 'ifDifferent' });
    expect(item('unitPrice')?.rule).toBe('§29/1i ZDPH');
    expect(item('taxBase')?.rule).toBe('§29/1j ZDPH');
    expect(item('vatRate')?.rule).toBe('§29/1k ZDPH');
    expect(item('vatAmount')).toMatchObject({ rule: '§29/1l ZDPH', note: 'inHomeCurrency' });
    // "Označení osoby" includes the seat: §29/4 ZDPH.
    expect(item('supplierAddress')?.rule).toBe('§29/4 ZDPH');
    // The IČO and the register entry come from §435 OZ, not the VAT act.
    expect(item('supplierIco')).toMatchObject({ level: 'conditional', rule: '§435 OZ', note: 'ifAssigned' });
    expect(item('supplierRegistry')).toMatchObject({ rule: '§435 OZ', note: 'ifRegistered' });
    expect(ids()).not.toContain('reverseChargeNote');
    expect(ids()).not.toContain('nonPayerNote');
  });

  it('domestic reverse charge (§92a ZDPH): buyer DIČ required, no VAT amount, the note required', () => {
    const c = list({ reverseCharge: true });
    expect(c.items.find((i) => i.id === 'customerDic')).toMatchObject({ level: 'required' });
    expect(c.items.find((i) => i.id === 'vatAmount')).toBeUndefined();
    expect(c.items.find((i) => i.id === 'vatRate')).toMatchObject({ level: 'recommended', note: 'noVatAmountReverse' });
    expect(c.items.find((i) => i.id === 'reverseChargeNote')).toMatchObject({ level: 'required', rule: '§29/2 ZDPH' });
    expect(c.notices).toContain('reverseChargeDomesticOnly');
  });

  it('EU business: the buyer’s VAT ID is required; service → reverse-charge note, goods → exemption note', () => {
    expect(item('customerDic', { customer: 'eu_business', reverseCharge: true })).toMatchObject({ level: 'required', note: 'buyerVatId' });
    expect(ids({ customer: 'eu_business', reverseCharge: true })).toContain('reverseChargeNote');
    const goods = list({ customer: 'eu_business', reverseCharge: false });
    expect(goods.items.find((i) => i.id === 'exemptionNote')).toMatchObject({ level: 'required', note: 'exemptEuGoods' });
    expect(goods.items.find((i) => i.id === 'vatAmount')).toBeUndefined();
  });

  it('outside the EU: no reverse charge, a conditional exemption note, no buyer DIČ', () => {
    const c = list({ customer: 'non_eu', reverseCharge: true });
    expect(c.scenario.reverseCharge).toBe(false);
    expect(c.items.find((i) => i.id === 'exemptionNote')).toMatchObject({ level: 'conditional', note: 'exportOrAbroad' });
    expect(c.items.find((i) => i.id === 'customerDic')).toBeUndefined();
  });

  it('consumer: VAT is shown, no buyer DIČ or IČO, and a notice that a tax document is not compulsory', () => {
    const c = list({ customer: 'consumer' });
    expect(c.items.map((i) => i.id)).toEqual(expect.arrayContaining(['vatRate', 'vatAmount', 'customerName']));
    expect(c.items.map((i) => i.id)).not.toContain('customerDic');
    expect(c.items.map((i) => i.id)).not.toContain('customerIco');
    expect(c.notices).toContain('consumerNoTaxDocumentDuty');
  });

  it('credit note (§45 ZDPH): original number, reason and difference, no due date', () => {
    const c = list({ document: 'credit_note' });
    expect(c.items.find((i) => i.id === 'originalNumber')).toMatchObject({ level: 'required', rule: '§45 ZDPH' });
    expect(c.items.find((i) => i.id === 'correctionReason')).toMatchObject({ level: 'required', rule: '§45 ZDPH' });
    expect(c.items.find((i) => i.id === 'correctionDifference')).toMatchObject({ level: 'required', rule: '§45 ZDPH' });
    expect(c.items.map((i) => i.id)).not.toContain('dueDate');
    expect(c.items.map((i) => i.id)).not.toContain('taxPointDate');
  });

  it('simplified tax document (§30 ZDPH): no buyer, rate and total, the 10 000 Kč notice', () => {
    const c = list({ document: 'simplified' });
    expect(c.taxDocument).toBe(true);
    expect(c.items.some((i) => i.group === 'customer')).toBe(false);
    expect(c.items.find((i) => i.id === 'total')).toMatchObject({ level: 'required', rule: '§30 ZDPH', note: 'totalOrBase' });
    expect(c.items.find((i) => i.id === 'vatRate')?.rule).toBe('§30 ZDPH');
    expect(c.notices).toContain('simplifiedLimitCz');
  });

  it('pro forma is no tax document (§28 ZDPH): business-law items only, plus a notice', () => {
    const c = list({ document: 'proforma' });
    expect(c.taxDocument).toBe(false);
    expect(c.items.map((i) => i.id)).not.toContain('supplierDic');
    expect(c.items.find((i) => i.id === 'documentLabel')).toMatchObject({ note: 'proformaLabel' });
    expect(c.notices).toContain('proformaTaxDocument');
  });
});

describe('invoiceChecklist – non-payer and identified person', () => {
  it('non-payer: §435 OZ items, good-practice extras, the "not a VAT payer" note, no VAT', () => {
    const c = list({ vatStatus: 'non_payer' });
    expect(c.taxDocument).toBe(false);
    const required = c.items.filter((i) => i.level !== 'recommended').map((i) => i.id);
    expect(required).toEqual(['supplierName', 'supplierAddress', 'supplierIco', 'supplierRegistry']);
    expect(c.items.every((i) => !i.rule || i.rule === '§435 OZ')).toBe(true);
    expect(c.items.map((i) => i.id)).toContain('nonPayerNote');
    expect(c.items.map((i) => i.id)).not.toContain('vatAmount');
    expect(c.notices).toContain('nonPayerNoVat');
  });

  it('non-payer cannot issue a simplified tax document or use reverse charge', () => {
    const { scenario, notices } = normalizeScenario({ ...base, vatStatus: 'non_payer', document: 'simplified', reverseCharge: true });
    expect(scenario).toMatchObject({ document: 'invoice', reverseCharge: false });
    expect(notices).toEqual(['simplifiedNotForNonPayer']);
  });

  it('identified person: a tax document only for a service to an EU business', () => {
    const eu = list({ vatStatus: 'identified', customer: 'eu_business', reverseCharge: false });
    // For an identified person the EU case is always the reverse-charge service.
    expect(eu.scenario.reverseCharge).toBe(true);
    expect(eu.taxDocument).toBe(true);
    expect(eu.items.map((i) => i.id)).toEqual(expect.arrayContaining(['supplierDic', 'customerDic', 'reverseChargeNote']));
    expect(eu.notices).toContain('identifiedEuService');

    const domestic = list({ vatStatus: 'identified', customer: 'business', reverseCharge: true });
    expect(domestic.scenario.reverseCharge).toBe(false);
    expect(domestic.taxDocument).toBe(false);
    expect(domestic.notices).toContain('identifiedNoTaxDocument');
  });
});

describe('invoiceChecklist – Slovakia (§74 ZoDPH, §3a ObZ)', () => {
  it('cites §74 ods. 1 ZoDPH for a payer and §3a ObZ for the business-law items', () => {
    const c = list({ country: 'SK' });
    expect(item('supplierDic', { country: 'SK' })?.rule).toBe('§74/1 ZoDPH');
    expect(item('supplierIco', { country: 'SK' })?.rule).toBe('§3a ObZ');
    expect(c.items.find((i) => i.id === 'supplierAddress')?.rule).toBe('§74/1 ZoDPH');
  });

  it('credit note cites §71 ZoDPH for the correction items', () => {
    expect(item('originalNumber', { country: 'SK', document: 'credit_note' })?.rule).toBe('§71 ZoDPH');
    expect(item('correctionDifference', { country: 'SK', document: 'credit_note' })?.rule).toBe('§71 ZoDPH');
  });

  it('simplified invoice (§74 ods. 3) carries the 1 000 € notice', () => {
    const c = list({ country: 'SK', document: 'simplified' });
    expect(c.items.find((i) => i.id === 'total')?.rule).toBe('§74/3 ZoDPH');
    expect(c.notices).toContain('simplifiedLimitSk');
  });

  it('non-payer cites §3a ObZ', () => {
    expect(item('supplierName', { country: 'SK', vatStatus: 'non_payer' })?.rule).toBe('§3a ObZ');
  });
});

describe('normalizeScenario', () => {
  it('turns a simplified document across borders into an invoice', () => {
    expect(normalizeScenario({ ...base, document: 'simplified', customer: 'eu_business' })).toEqual({
      scenario: { ...base, document: 'invoice', customer: 'eu_business' },
      notices: ['simplifiedNotCrossBorder']
    });
  });

  it('drops reverse charge for consumers', () => {
    expect(normalizeScenario({ ...base, customer: 'consumer', reverseCharge: true }).scenario.reverseCharge).toBe(false);
  });

  it('leaves a valid scenario untouched', () => {
    expect(normalizeScenario({ ...base, reverseCharge: true })).toEqual({ scenario: { ...base, reverseCharge: true }, notices: [] });
  });
});
