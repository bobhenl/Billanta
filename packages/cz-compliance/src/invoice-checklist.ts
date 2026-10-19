import type { VatStatus } from './vat-status.js';

/**
 * What a CZ/SK document must contain, as a list the public checker shows
 * and the ISDOC viewer ticks off. Unlike `checkInvoiceRequirements` (which
 * looks at the data of one invoice before it is issued), this starts from
 * who the visitor is and what they issue, and lists every item with its
 * legal basis.
 *
 * Sources (rule strings resolve through `lawUrl`):
 * - every entrepreneur, every business document: §435 zákona č. 89/2012 Sb.,
 *   občanský zákoník (CZ) / §3a zákona č. 513/1991 Zb., Obchodný zákonník (SK);
 * - tax document of a VAT payer: §29 zákona č. 235/2004 Sb. o DPH (CZ, letters
 *   a–l of odst. 1, notes of odst. 2, "označení osoby" = name + seat, odst. 4) /
 *   §74 ods. 1 zákona č. 222/2004 Z. z. o DPH (SK, letters a–m);
 * - simplified tax document: §30 ZDPH (up to 10 000 Kč incl. VAT) /
 *   §74 ods. 3 ZoDPH (zjednodušená faktúra up to 1 000 € incl. VAT);
 * - correction (credit note): §45 ZDPH (opravný daňový doklad) / §71 ZoDPH;
 * - domestic reverse charge: §92a ZDPH ("daň odvede zákazník", no VAT amount) /
 *   §69 ods. 12 ZoDPH ("prenesenie daňovej povinnosti", a note under §74 ods. 1);
 * - service to a business in another EU state: art. 196 of Directive
 *   2006/112/EC, the note under §29/2b ZDPH / §74 ods. 1 ZoDPH, the buyer's VAT
 *   ID under §29/1d ZDPH / §74 ods. 1 ZoDPH;
 * - exempt EU supply of goods and export: the exemption note, §29/2a ZDPH
 *   (with §64 / §66) / §74 ods. 1 ZoDPH (with §43 / §47);
 * - a pro forma is no tax document; after the payment arrives the payer issues
 *   one within 15 days (§28 ZDPH / §73 ZoDPH).
 *
 * Items without a `rule` are good practice (payment details, the "not a VAT
 * payer" note) and are labelled as such, never as a legal duty.
 */

export const CHECKLIST_COUNTRIES = ['CZ', 'SK'] as const;
export type ChecklistCountry = (typeof CHECKLIST_COUNTRIES)[number];

export const CHECKLIST_DOCUMENTS = ['invoice', 'proforma', 'credit_note', 'simplified'] as const;
export type ChecklistDocument = (typeof CHECKLIST_DOCUMENTS)[number];

/** `business` is a domestic business; `eu_business` a business in another EU state; `non_eu` any buyer outside the EU. */
export const CHECKLIST_CUSTOMERS = ['business', 'consumer', 'eu_business', 'non_eu'] as const;
export type ChecklistCustomer = (typeof CHECKLIST_CUSTOMERS)[number];

export interface ChecklistScenario {
  country: ChecklistCountry;
  vatStatus: VatStatus;
  document: ChecklistDocument;
  customer: ChecklistCustomer;
  /** Domestic reverse charge (§92a ZDPH / §69 ods. 12 ZoDPH) or the EU service rule. */
  reverseCharge: boolean;
}

export const CHECKLIST_ITEM_IDS = [
  'supplierName',
  'supplierAddress',
  'supplierIco',
  'supplierRegistry',
  'supplierDic',
  'customerName',
  'customerAddress',
  'customerIco',
  'customerDic',
  'documentLabel',
  'number',
  'originalNumber',
  'issueDate',
  'taxPointDate',
  'subject',
  'unitPrice',
  'taxBase',
  'vatRate',
  'vatAmount',
  'total',
  'correctionReason',
  'correctionDifference',
  'reverseChargeNote',
  'exemptionNote',
  'nonPayerNote',
  'dueDate',
  'paymentDetails'
] as const;
export type ChecklistItemId = (typeof CHECKLIST_ITEM_IDS)[number];

export type ChecklistGroup = 'supplier' | 'customer' | 'document' | 'amounts' | 'payment';

/**
 * - `required`: the law asks for it on this document;
 * - `conditional`: required only when the `note` says so (the buyer has a DIČ,
 *   the date differs from the issue date …);
 * - `recommended`: no law requires it, but an invoice without it gets paid late.
 */
export type ChecklistLevel = 'required' | 'conditional' | 'recommended';

/** Short qualifier shown next to an item; the apps translate it. */
export type ChecklistNote =
  | 'ifAssigned'
  | 'ifRegistered'
  | 'ifBuyerHasDic'
  | 'ifDifferent'
  | 'buyerVatId'
  | 'perRate'
  | 'inHomeCurrency'
  | 'noVatAmountReverse'
  | 'totalOrBase'
  | 'proformaLabel'
  | 'creditLabel'
  | 'simplifiedLabel'
  | 'exemptEuGoods'
  | 'exportOrAbroad';

export interface ChecklistItem {
  id: ChecklistItemId;
  group: ChecklistGroup;
  level: ChecklistLevel;
  /** "§29/1a ZDPH", "§3a ObZ" … (see `lawUrl`); none for good practice. */
  rule?: string;
  note?: ChecklistNote;
}

/** Remarks about the situation as a whole (e.g. "a non-payer issues no simplified tax document"). */
export type ChecklistNotice =
  | 'simplifiedNotForNonPayer'
  | 'simplifiedLimitCz'
  | 'simplifiedLimitSk'
  | 'simplifiedNotCrossBorder'
  | 'proformaTaxDocument'
  | 'identifiedNoTaxDocument'
  | 'identifiedEuService'
  | 'reverseChargeDomesticOnly'
  | 'consumerNoTaxDocumentDuty'
  | 'nonPayerNoVat';

export interface Checklist {
  /** The scenario after impossible combinations were resolved (see `normalizeScenario`). */
  scenario: ChecklistScenario;
  /** Whether the document is a tax document (daňový doklad / faktúra under the VAT act). */
  taxDocument: boolean;
  items: ChecklistItem[];
  notices: ChecklistNotice[];
}

/**
 * Drops combinations the law does not have, so the checklist never shows
 * rules for a case that cannot happen:
 * - a non-payer or an identified person issues no simplified tax document
 *   (§30 ZDPH / §74/3 ZoDPH are for payers) → an ordinary invoice;
 * - a simplified document is not allowed for EU and export supplies
 *   (§30/2 ZDPH, §74/3 ZoDPH) → an ordinary invoice;
 * - reverse charge only exists between businesses: never for a consumer or
 *   a non-payer; for an identified person it is the only case (EU service);
 * - an EU business: the EU service rule (reverse charge) is on by default
 *   unless the visitor says it is goods (exempt supply) by switching it off.
 */
export function normalizeScenario(s: ChecklistScenario): { scenario: ChecklistScenario; notices: ChecklistNotice[] } {
  const notices: ChecklistNotice[] = [];
  let { document, reverseCharge } = s;
  const { country, vatStatus, customer } = s;

  if (document === 'simplified' && vatStatus !== 'payer') {
    notices.push('simplifiedNotForNonPayer');
    document = 'invoice';
  } else if (document === 'simplified' && (customer === 'eu_business' || customer === 'non_eu')) {
    notices.push('simplifiedNotCrossBorder');
    document = 'invoice';
  }
  if (vatStatus === 'non_payer' || customer === 'consumer' || customer === 'non_eu') reverseCharge = false;
  if (vatStatus === 'identified') reverseCharge = customer === 'eu_business';

  return { scenario: { country, vatStatus, document, customer, reverseCharge }, notices };
}

export function invoiceChecklist(input: ChecklistScenario): Checklist {
  const { scenario, notices } = normalizeScenario(input);
  const { country, vatStatus, document, customer, reverseCharge } = scenario;
  const sk = country === 'SK';
  const items: ChecklistItem[] = [];
  const add = (id: ChecklistItemId, group: ChecklistGroup, level: ChecklistLevel, rule?: string, note?: ChecklistNote) =>
    items.push({ id, group, level, ...(rule ? { rule } : {}), ...(note ? { note } : {}) });

  // An identified person issues a tax document only for a service to an EU business (§28 ZDPH / §7a ZoDPH).
  const identifiedTax = vatStatus === 'identified' && customer === 'eu_business' && document !== 'proforma';
  const taxDocument = document !== 'proforma' && (vatStatus === 'payer' || identifiedTax);

  if (taxDocument) {
    taxItems(add, scenario, identifiedTax);
  } else {
    civilItems(add, scenario);
  }

  // Situation notices.
  if (document === 'simplified') notices.push(sk ? 'simplifiedLimitSk' : 'simplifiedLimitCz');
  if (document === 'proforma' && vatStatus === 'payer') notices.push('proformaTaxDocument');
  if (vatStatus === 'identified') notices.push(identifiedTax ? 'identifiedEuService' : 'identifiedNoTaxDocument');
  if (vatStatus === 'payer' && reverseCharge && customer === 'business') notices.push('reverseChargeDomesticOnly');
  if (vatStatus === 'payer' && customer === 'consumer' && document === 'invoice') notices.push('consumerNoTaxDocumentDuty');
  if (vatStatus === 'non_payer') notices.push('nonPayerNoVat');

  return { scenario, taxDocument, items, notices };
}

type Add = (id: ChecklistItemId, group: ChecklistGroup, level: ChecklistLevel, rule?: string, note?: ChecklistNote) => void;

/** Business-law items every entrepreneur prints (§435 OZ / §3a ObZ). */
function supplierCivil(add: Add, sk: boolean) {
  const civil = sk ? '§3a ObZ' : '§435 OZ';
  add('supplierName', 'supplier', 'required', civil);
  add('supplierAddress', 'supplier', 'required', civil);
  add('supplierIco', 'supplier', 'conditional', civil, 'ifAssigned');
  add('supplierRegistry', 'supplier', 'required', civil, 'ifRegistered');
}

/** Non-payers, pro formas, an identified person outside the EU service case: no VAT rules, only business law and good practice. */
function civilItems(add: Add, s: ChecklistScenario) {
  const sk = s.country === 'SK';
  supplierCivil(add, sk);
  const business = s.customer !== 'consumer';
  add('customerName', 'customer', 'recommended');
  add('customerAddress', 'customer', 'recommended');
  if (business) add('customerIco', 'customer', 'recommended');
  if (s.document === 'proforma') add('documentLabel', 'document', 'recommended', undefined, 'proformaLabel');
  if (s.document === 'credit_note') add('documentLabel', 'document', 'recommended', undefined, 'creditLabel');
  add('number', 'document', 'recommended');
  if (s.document === 'credit_note') add('originalNumber', 'document', 'recommended');
  add('issueDate', 'document', 'recommended');
  add('subject', 'document', 'recommended');
  if (s.document === 'credit_note') add('correctionReason', 'document', 'recommended');
  add('total', 'amounts', 'recommended');
  if (s.vatStatus !== 'payer') add('nonPayerNote', 'amounts', 'recommended');
  if (s.document !== 'credit_note') {
    add('dueDate', 'payment', 'recommended');
    add('paymentDetails', 'payment', 'recommended');
  }
}

function taxItems(add: Add, s: ChecklistScenario, identified: boolean) {
  const sk = s.country === 'SK';
  // §29/1 ZDPH letters; Slovak §74/1 has its own lettering (a = supplier incl. IČ DPH, b = buyer incl. IČ DPH …).
  const cz = (letter: string) => `§29/1${letter} ZDPH`;
  const SK74 = '§74/1 ZoDPH';
  const L = sk
    ? { sName: SK74, sDic: SK74, cName: SK74, cDic: SK74, no: SK74, taxPoint: SK74, issue: SK74, subject: SK74, unit: SK74, base: SK74, rate: SK74, vat: SK74, note: SK74 }
    : { sName: cz('a'), sDic: cz('b'), cName: cz('c'), cDic: cz('d'), no: cz('e'), taxPoint: cz('h'), issue: cz('g'), subject: cz('f'), unit: cz('i'), base: cz('j'), rate: cz('k'), vat: cz('l'), note: '§29/2 ZDPH' };
  const simplified = s.document === 'simplified';
  const credit = s.document === 'credit_note';
  const simpl = sk ? '§74/3 ZoDPH' : '§30 ZDPH';
  const corr = sk ? '§71 ZoDPH' : '§45 ZDPH';
  const pick = (normal: string) => (simplified ? simpl : credit && !sk ? corr : normal);
  const reverse = s.reverseCharge;

  // Supplier: VAT law identification + business-law items the VAT act does not cover (IČO, register).
  add('supplierName', 'supplier', 'required', pick(L.sName));
  add('supplierAddress', 'supplier', 'required', simplified ? simpl : sk ? L.sName : '§29/4 ZDPH');
  add('supplierDic', 'supplier', 'required', pick(L.sDic));
  add('supplierIco', 'supplier', 'conditional', sk ? '§3a ObZ' : '§435 OZ', 'ifAssigned');
  add('supplierRegistry', 'supplier', 'required', sk ? '§3a ObZ' : '§435 OZ', 'ifRegistered');

  // Buyer: a simplified document may leave the buyer out (§30/1 ZDPH, §74/3 ZoDPH).
  if (!simplified) {
    add('customerName', 'customer', 'required', credit && !sk ? corr : L.cName);
    add('customerAddress', 'customer', 'required', sk ? L.cName : '§29/4 ZDPH');
    if (s.customer === 'business') add('customerIco', 'customer', 'recommended');
    const crossBorder = s.customer === 'eu_business';
    if (crossBorder || reverse) add('customerDic', 'customer', 'required', credit && !sk ? corr : L.cDic, crossBorder ? 'buyerVatId' : undefined);
    else if (s.customer !== 'consumer' && s.customer !== 'non_eu') add('customerDic', 'customer', 'conditional', credit && !sk ? corr : L.cDic, 'ifBuyerHasDic');
  }

  // Document.
  if (credit) add('documentLabel', 'document', 'recommended', undefined, 'creditLabel');
  if (simplified) add('documentLabel', 'document', 'recommended', undefined, 'simplifiedLabel');
  add('number', 'document', 'required', pick(L.no));
  if (credit) add('originalNumber', 'document', 'required', corr);
  add('issueDate', 'document', 'required', pick(L.issue));
  if (!credit) add('taxPointDate', 'document', 'conditional', simplified ? simpl : L.taxPoint, 'ifDifferent');
  add('subject', 'document', 'required', pick(L.subject));
  if (credit) add('correctionReason', 'document', 'required', corr);

  // Amounts.
  if (credit) {
    add('correctionDifference', 'amounts', 'required', corr);
  } else if (simplified) {
    add('vatRate', 'amounts', 'required', simpl);
    add('total', 'amounts', 'required', simpl, 'totalOrBase');
  } else {
    add('unitPrice', 'amounts', 'required', L.unit);
    add('taxBase', 'amounts', 'required', L.base, 'perRate');
    if (reverse || identified) {
      // Under reverse charge the buyer computes the VAT (§92a/2 ZDPH, §69 ods. 12 ZoDPH).
      add('vatRate', 'amounts', 'recommended', undefined, 'noVatAmountReverse');
    } else if (s.customer !== 'eu_business' && s.customer !== 'non_eu') {
      add('vatRate', 'amounts', 'required', L.rate);
      add('vatAmount', 'amounts', 'required', L.vat, 'inHomeCurrency');
    }
    // Exempt EU goods and exports carry the exemption note instead of a rate (below).
    add('total', 'amounts', 'recommended');
  }

  // Notes the VAT act asks for in special cases.
  if (reverse || identified) add('reverseChargeNote', 'amounts', 'required', L.note);
  else if (s.customer === 'eu_business') add('exemptionNote', 'amounts', 'required', L.note, 'exemptEuGoods');
  else if (s.customer === 'non_eu') add('exemptionNote', 'amounts', 'conditional', L.note, 'exportOrAbroad');

  if (!credit && !simplified) {
    add('dueDate', 'payment', 'recommended');
    add('paymentDetails', 'payment', 'recommended');
  }
}
