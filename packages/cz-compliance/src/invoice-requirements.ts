import type { IsdocParty } from './isdoc-generator.js';

/**
 * Mandatory content of a CZ/SK tax document, checked before issuing:
 * §29 zákona o DPH and §435 občanského zákoníku (CZ), §74 zákona o DPH and
 * §3a Obchodného zákonníka (SK). Only the data a user can forget is checked;
 * the document layout (number, dates, VAT recap, the reverse-charge note)
 * comes from the generator.
 */
export interface InvoiceRequirementsInput {
  supplier: IsdocParty & { registryNote?: string };
  customer?: IsdocParty;
  /** Whether the supplier issues tax documents (plátce DPH). */
  vatPayer: boolean;
  reverseCharge?: boolean;
  /** Pro forma and quotes are not tax documents; only the civil-law rules apply. */
  taxDocument: boolean;
  lines: { description: string; quantity: number }[];
}

export interface RequirementIssue {
  /** Legal basis, e.g. "§29/1c ZDPH". */
  rule: string;
  field: 'supplier' | 'customer' | 'lines';
  code: string;
  severity: 'error' | 'warning';
}

export function checkInvoiceRequirements(input: InvoiceRequirementsInput): RequirementIssue[] {
  const issues: RequirementIssue[] = [];
  const sk = input.supplier.address?.countryCode?.toUpperCase() === 'SK';
  const vatLaw = sk ? '§74/1 ZoDPH' : '§29/1 ZDPH';
  const civil = sk ? '§3a ObZ' : '§435 OZ';
  const add = (rule: string, field: RequirementIssue['field'], code: string, severity: RequirementIssue['severity'] = 'error') =>
    issues.push({ rule, field, code, severity });
  const blank = (v: string | undefined) => !v?.trim();
  const tax = input.taxDocument && input.vatPayer;

  const s = input.supplier;
  if (blank(s.legalName)) add(civil, 'supplier', 'nameMissing');
  if (blank(s.address?.street) || blank(s.address?.city)) add(civil, 'supplier', 'addressIncomplete');
  if (blank(s.ico)) add(civil, 'supplier', 'icoMissing', 'warning');
  if (tax && blank(s.dic)) add(vatLaw, 'supplier', 'dicMissing');
  if (!sk && !input.vatPayer && blank(s.registryNote)) add(civil, 'supplier', 'registryMissing', 'warning');

  const c = input.customer;
  if (!c) add(vatLaw, 'customer', 'customerMissing');
  else {
    if (blank(c.legalName)) add(vatLaw, 'customer', 'nameMissing');
    if (blank(c.address?.street) || blank(c.address?.city)) add(vatLaw, 'customer', 'addressIncomplete', tax ? 'error' : 'warning');
    // Reverse charge needs the buyer's VAT number (§92a ZDPH, §69 ZoDPH; EU supplies §64 ZDPH).
    if (tax && input.reverseCharge && blank(c.dic)) add(vatLaw, 'customer', 'dicMissingReverse');
    else if (tax && c.isVatPayer && blank(c.dic)) add(vatLaw, 'customer', 'dicMissing', 'warning');
  }

  if (input.lines.length === 0) add(vatLaw, 'lines', 'noLines');
  if (input.lines.some((l) => blank(l.description))) add(vatLaw, 'lines', 'lineNameMissing');
  if (input.lines.some((l) => !l.quantity)) add(vatLaw, 'lines', 'zeroQuantity', 'warning');
  return issues;
}
