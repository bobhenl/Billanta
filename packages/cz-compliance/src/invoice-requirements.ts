import type { IsdocParty } from './isdoc-generator.js';
import { buyerKind, type VatStatus } from './vat-status.js';

/**
 * Mandatory content of a CZ/SK document, checked before issuing. Which law
 * applies depends on the supplier's VAT status and on the buyer:
 *
 * - Supplier, always: §435 občanského zákoníku (CZ) / §3a Obchodného zákonníka (SK).
 * - Plátce, tax document: §29 zákona o DPH (CZ) / §74 zákona o DPH (SK).
 * - Identifikovaná osoba: a tax document only for a service to a business in
 *   another EU state (§28/3 ZDPH); then the buyer's name, seat (§29/4) and
 *   VAT ID (§29/1d) are required. Private persons and buyers outside the EU:
 *   no VAT rules.
 * - Neplátce: no VAT rules at all.
 *
 * Only the data a user can forget is checked; the document layout (number,
 * dates, VAT recap, the "daň odvede zákazník" note) comes from the generator.
 */
export interface InvoiceRequirementsInput {
  supplier: IsdocParty & { registryNote?: string };
  /** `isPerson`: a private individual (contacts.is_person); unset = guessed from missing IČO and DIČ. */
  customer?: IsdocParty & { isPerson?: boolean };
  /** The supplier's VAT status; wins over `vatPayer`. */
  vatStatus?: VatStatus;
  /** Legacy: true = plátce, false = neplátce. Used only when `vatStatus` is missing. */
  vatPayer?: boolean;
  reverseCharge?: boolean;
  /** Pro forma and quotes are not tax documents; only the civil-law rules apply. */
  taxDocument: boolean;
  lines: { description: string; quantity: number }[];
}

export interface RequirementIssue {
  /** Legal basis, e.g. "§29/1c ZDPH". Missing when no law requires it (a plain practical check). */
  rule?: string;
  field: 'supplier' | 'customer' | 'lines';
  code: string;
  severity: 'error' | 'warning';
}

const blank = (v: string | undefined) => !v?.trim();
/** Street or city missing, or an e-mail typed where the street should be. */
const noAddress = (a: IsdocParty['address'] | undefined) => blank(a?.street) || blank(a?.city) || /@/.test(a?.street ?? '');

export function checkInvoiceRequirements(input: InvoiceRequirementsInput): RequirementIssue[] {
  const issues: RequirementIssue[] = [];
  const status: VatStatus = input.vatStatus ?? (input.vatPayer ? 'payer' : 'non_payer');
  const supplierCountry = input.supplier.address?.countryCode?.toUpperCase() || 'CZ';
  const sk = supplierCountry === 'SK';
  const civil = sk ? '§3a ObZ' : '§435 OZ';
  const add = (rule: string | undefined, field: RequirementIssue['field'], code: string, severity: RequirementIssue['severity'] = 'error') =>
    issues.push(rule ? { rule, field, code, severity } : { field, code, severity });

  const c = input.customer;
  const payer = status === 'payer';
  const tax = input.taxDocument && payer;
  // An identified person's only tax document: a service to a business in another EU state.
  const euService = status === 'identified' && input.taxDocument && !!c && buyerKind(supplierCountry, c) === 'eu_business';
  const vatLaw = sk ? '§74/1 ZoDPH' : '§29/1 ZDPH';
  // Slovak §7a registrants: the paragraph is cited without the letter (less specific rather than wrong).
  const eu = sk
    ? { dic: '§74 ZoDPH', name: '§74 ZoDPH', seat: '§74 ZoDPH', buyerDic: '§74 ZoDPH', lines: '§74 ZoDPH' }
    : { dic: '§29/1b ZDPH', name: '§29/1c ZDPH', seat: '§29/4 ZDPH', buyerDic: '§29/1d ZDPH', lines: '§29/1f ZDPH' };

  const s = input.supplier;
  if (blank(s.legalName)) add(civil, 'supplier', 'nameMissing');
  if (blank(s.address?.street) || blank(s.address?.city)) add(civil, 'supplier', 'addressIncomplete');
  if (blank(s.ico)) add(civil, 'supplier', 'icoMissing', 'warning');
  if (tax && blank(s.dic)) add(vatLaw, 'supplier', 'dicMissing');
  if (euService && blank(s.dic)) add(eu.dic, 'supplier', 'dicMissing');
  if (!sk && !payer && blank(s.registryNote)) add(civil, 'supplier', 'registryMissing', 'warning');

  if (payer) {
    // Plátce: §29 ZDPH / §74 ZoDPH, unchanged.
    if (!c) add(vatLaw, 'customer', 'customerMissing');
    else {
      if (blank(c.legalName)) add(vatLaw, 'customer', 'nameMissing');
      if (noAddress(c.address)) add(vatLaw, 'customer', 'addressIncomplete', tax ? 'error' : 'warning');
      // Reverse charge needs the buyer's VAT number (§92a ZDPH, §69 ZoDPH; EU supplies §64 ZDPH).
      if (tax && input.reverseCharge && blank(c.dic)) add(vatLaw, 'customer', 'dicMissingReverse');
      else if (tax && c.isVatPayer && blank(c.dic)) add(vatLaw, 'customer', 'dicMissing', 'warning');
    }
    if (input.lines.length === 0) add(vatLaw, 'lines', 'noLines');
    if (input.lines.some((l) => blank(l.description))) add(vatLaw, 'lines', 'lineNameMissing');
    if (input.lines.some((l) => !l.quantity)) add(vatLaw, 'lines', 'zeroQuantity', 'warning');
    return issues;
  }

  if (euService && c) {
    if (blank(c.legalName)) add(eu.name, 'customer', 'nameMissing');
    if (noAddress(c.address)) add(eu.seat, 'customer', 'addressIncomplete');
    if (blank(c.dic)) add(eu.buyerDic, 'customer', 'dicMissingReverse');
  } else if (!c) {
    // No law asks a non-payer for the buyer; a document without one is still most likely a mistake.
    add(undefined, 'customer', 'customerMissing', 'warning');
  }

  const linesRule = euService ? eu.lines : undefined;
  if (input.lines.length === 0) add(linesRule, 'lines', 'noLines');
  if (input.lines.some((l) => blank(l.description))) add(linesRule, 'lines', 'lineNameMissing', euService ? 'error' : 'warning');
  if (input.lines.some((l) => !l.quantity)) add(linesRule, 'lines', 'zeroQuantity', 'warning');
  return issues;
}
