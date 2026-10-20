/**
 * Runs the invoice checklist (`invoiceChecklist`) over a parsed ISDOC file:
 * guesses the scenario from the document, marks each mandatory item as
 * present or missing, and checks what can be checked offline (IČO/DIČ
 * checksums, bank account, the VAT arithmetic). Used by the public ISDOC
 * viewer; the visitor can correct the guessed scenario.
 */
import { isValidCzechBankAccount, isValidIban } from './bank-account-validator.js';
import { invoiceChecklist, type Checklist, type ChecklistItem, type ChecklistItemId, type ChecklistScenario } from './invoice-checklist.js';
import type { ParsedIsdoc, ParsedIsdocParty } from './isdoc-parser.js';
import { checkTaxId, isValidIco } from './tax-ids.js';
import { buyerKind } from './vat-status.js';

/**
 * - `ok`: present (and valid where it can be checked);
 * - `missing`: a required item is not in the file;
 * - `invalid`: present but wrong (bad checksum, incomplete address …);
 * - `unknown`: a conditional item is absent, which is fine when its condition does not apply.
 */
export type IsdocItemStatus = 'ok' | 'missing' | 'invalid' | 'unknown';

export interface IsdocCheckedItem extends ChecklistItem {
  status: IsdocItemStatus;
}

export type IsdocFindingCode =
  | 'supplierIcoInvalid'
  | 'customerIcoInvalid'
  | 'supplierDicInvalid'
  | 'customerDicInvalid'
  | 'bankAccountInvalid'
  | 'ibanInvalid'
  | 'noLines'
  | 'lineAmountMismatch'
  | 'linesTotalMismatch'
  | 'subtotalVatMismatch'
  | 'vatTotalMismatch'
  | 'inclusiveMismatch'
  | 'payableMismatch'
  | 'invalidDate'
  | 'dueBeforeIssue'
  | 'vatOnNonPayer'
  | 'simplifiedOverLimit';

export interface IsdocFinding {
  code: IsdocFindingCode;
  severity: 'error' | 'warning';
  /** The offending value (an ID, an account, a line number). */
  value?: string;
  expected?: number;
  actual?: number;
}

export interface IsdocCheck {
  checklist: Checklist;
  items: IsdocCheckedItem[];
  findings: IsdocFinding[];
}

const REVERSE_RE = /da[ňn] odvede z[áa]kazn[íi]k|p[řr]enesen[íi] da[ňn]ov[ée] povinnosti|prenesenie da[ňn]ovej povinnosti|reverse charge|autoliquidaci[óo]n|steuerschuldnerschaft/i;
const EXEMPT_RE = /osvobozen|oslobod|exempt|steuerfrei|§\s*6[4-6]\b|§\s*4[37]\b|čl(?:\.|ánek|ánok)\s*1[34][68]|article\s*1[34][68]|v[ýy]voz|export/i;
const NON_PAYER_RE = /nen[íi] pl[áa]tce|nepl[áa]tce|nie je platite[ľl]|neplatite[ľl]|not (?:a )?vat[- ]payer|not registered for vat/i;
const REGISTRY_RE = /zaps[áa]n|zap[íi]san|spisov[áa] zna[čc]ka|odd[íi]l|odd\.|vlo[žz]ka|obchodn[íi]m rejst|obchodnom registri|živnostensk|živnostenskom/i;

/** Simplified tax document limits: 10 000 Kč (§30/1 ZDPH), 1 000 € (§74/3 ZoDPH), both incl. VAT. */
const SIMPLIFIED_LIMIT = { CZ: { amount: 10000, currency: 'CZK' }, SK: { amount: 1000, currency: 'EUR' } } as const;

const isDate = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol + 1e-9;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function partyCountry(p: ParsedIsdocParty | undefined): string | undefined {
  return p?.countryCode || (p?.dic && /^[A-Za-z]{2}/.test(p.dic) ? p.dic.slice(0, 2).toUpperCase() : undefined);
}

/** Best guess of who issued the file and to whom; the viewer lets the visitor change it. */
export function inferIsdocScenario(doc: ParsedIsdoc): ChecklistScenario {
  const country = partyCountry(doc.supplier) === 'SK' ? 'SK' : 'CZ';
  const taxed = (doc.taxTotal ?? 0) !== 0 || doc.taxSubTotals.some((s) => (s.tax ?? 0) !== 0);
  const vatStatus = doc.vatApplicable === true || (doc.vatApplicable === undefined && taxed) ? 'payer' : 'non_payer';
  const document =
    doc.kind === 'proforma' ? 'proforma' : doc.kind === 'credit_note' || doc.kind === 'advance_credit' ? 'credit_note' : doc.kind === 'simplified' ? 'simplified' : 'invoice';
  const c = doc.customer;
  const kind = c ? buyerKind(country, { ico: c.ico, dic: c.dic, address: { countryCode: partyCountry(c) } }) : 'person';
  const customer = kind === 'person' ? 'consumer' : kind === 'domestic_business' ? 'business' : kind === 'eu_business' ? 'eu_business' : 'non_eu';
  const notes = doc.notes.join('\n');
  const reverseCharge =
    doc.lines.some((l) => l.reverseCharge) ||
    REVERSE_RE.test(notes) ||
    // To an EU business without VAT and without an exemption note: most likely the EU service rule.
    (customer === 'eu_business' && !taxed && !EXEMPT_RE.test(notes));
  return { country, vatStatus, document, customer, reverseCharge };
}

function addressStatus(p: ParsedIsdocParty | undefined): IsdocItemStatus {
  if (!p || (!p.street && !p.city && !p.postalCode && !p.buildingNumber)) return 'missing';
  return p.city && (p.street || p.buildingNumber) ? 'ok' : 'invalid';
}

function idStatus(value: string | undefined, valid: (v: string) => boolean): IsdocItemStatus {
  if (!value) return 'missing';
  return valid(value) ? 'ok' : 'invalid';
}

const dicValid = (v: string) => checkTaxId(v)?.valid ?? false;

function itemStatus(id: ChecklistItemId, doc: ParsedIsdoc, notes: string): IsdocItemStatus {
  const s = doc.supplier;
  const c = doc.customer;
  const lines = doc.lines;
  const has = (v: unknown) => (v === undefined || v === null || v === '' ? 'missing' : 'ok');
  const allLines = (pick: (l: ParsedIsdoc['lines'][number]) => unknown): IsdocItemStatus =>
    lines.length === 0 ? 'missing' : lines.every((l) => pick(l) !== undefined && pick(l) !== '') ? 'ok' : lines.some((l) => pick(l) !== undefined) ? 'invalid' : 'missing';
  switch (id) {
    case 'supplierName':
      return has(s.name);
    case 'supplierAddress':
      return addressStatus(s);
    case 'supplierIco':
      return idStatus(s.ico, isValidIco);
    case 'supplierRegistry':
      return s.registry || REGISTRY_RE.test(notes) ? 'ok' : 'missing';
    case 'supplierDic':
      return idStatus(s.dic, dicValid);
    case 'customerName':
      return has(c?.name);
    case 'customerAddress':
      return addressStatus(c);
    case 'customerIco':
      return idStatus(c?.ico, isValidIco);
    case 'customerDic':
      return idStatus(c?.dic, dicValid);
    case 'documentLabel':
      // The ISDOC DocumentType states the kind; viewers print the matching title.
      return has(doc.kind);
    case 'number':
      return has(doc.number);
    case 'originalNumber':
      return doc.originalDocuments.length ? 'ok' : 'missing';
    case 'issueDate':
      return doc.issueDate ? (isDate(doc.issueDate) ? 'ok' : 'invalid') : 'missing';
    case 'taxPointDate':
      return doc.taxPointDate ? (isDate(doc.taxPointDate) ? 'ok' : 'invalid') : 'missing';
    case 'subject':
      return allLines((l) => l.description);
    case 'unitPrice':
      return allLines((l) => l.unitPrice);
    case 'taxBase':
      return doc.taxSubTotals.some((t) => t.taxable !== undefined) || doc.totals.taxExclusive !== undefined ? 'ok' : 'missing';
    case 'vatRate':
      return lines.length && lines.every((l) => l.vatPercent !== undefined) ? 'ok' : doc.taxSubTotals.some((t) => t.percent !== undefined) ? 'ok' : 'missing';
    case 'vatAmount':
      return doc.taxTotal !== undefined || doc.taxSubTotals.some((t) => t.tax !== undefined) ? 'ok' : 'missing';
    case 'total':
      return has(doc.totals.taxInclusive ?? doc.totals.payable);
    case 'correctionReason':
      return doc.notes.length ? 'ok' : 'missing';
    case 'correctionDifference':
      return lines.length && (doc.totals.taxExclusive !== undefined || lines.some((l) => l.net !== undefined)) ? 'ok' : 'missing';
    case 'reverseChargeNote':
      return REVERSE_RE.test(notes) || lines.some((l) => l.reverseCharge) ? 'ok' : 'missing';
    case 'exemptionNote':
      return EXEMPT_RE.test(notes) ? 'ok' : 'missing';
    case 'nonPayerNote':
      return NON_PAYER_RE.test(notes) ? 'ok' : 'missing';
    case 'dueDate':
      return doc.dueDate ? (isDate(doc.dueDate) ? 'ok' : 'invalid') : 'missing';
    case 'paymentDetails': {
      if (!doc.payments.length) return 'missing';
      if (doc.payments.some((p) => p.code === '10' || p.code === '48')) return 'ok';
      const accounts = doc.payments.filter((p) => p.accountId || p.iban);
      if (!accounts.length) return 'missing';
      return accounts.every((p) => accountValid(p.accountId, p.bankCode, p.iban)) ? 'ok' : 'invalid';
    }
  }
}

function czAccount(id: string | undefined, bankCode: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.includes('/') ? id : bankCode ? `${id}/${bankCode}` : id;
}

/** A domestic account is checked only when it looks Czech (number/4-digit bank code); the IBAN always. */
function accountValid(id: string | undefined, bankCode: string | undefined, iban: string | undefined): boolean {
  if (iban && !isValidIban(iban)) return false;
  const acc = czAccount(id, bankCode);
  if (acc && /^[\d-]+\/\d{4}$/.test(acc.replace(/\s/g, ''))) return isValidCzechBankAccount(acc.replace(/\s/g, ''));
  return true;
}

/** Offline consistency checks of an ISDOC file (identifiers, account, VAT arithmetic, dates). */
export function isdocFindings(doc: ParsedIsdoc, scenario: ChecklistScenario): IsdocFinding[] {
  const out: IsdocFinding[] = [];
  const s = doc.supplier;
  const c = doc.customer;
  if (s.ico && !isValidIco(s.ico)) out.push({ code: 'supplierIcoInvalid', severity: 'error', value: s.ico });
  if (c?.ico && !isValidIco(c.ico)) out.push({ code: 'customerIcoInvalid', severity: 'error', value: c.ico });
  if (s.dic && !dicValid(s.dic)) out.push({ code: 'supplierDicInvalid', severity: 'error', value: s.dic });
  if (c?.dic && !dicValid(c.dic)) out.push({ code: 'customerDicInvalid', severity: 'error', value: c.dic });

  for (const p of doc.payments) {
    if (p.iban && !isValidIban(p.iban)) out.push({ code: 'ibanInvalid', severity: 'error', value: p.iban });
    const acc = czAccount(p.accountId, p.bankCode)?.replace(/\s/g, '');
    if (acc && /^[\d-]+\/\d{4}$/.test(acc) && !isValidCzechBankAccount(acc)) out.push({ code: 'bankAccountInvalid', severity: 'error', value: acc });
  }

  // Arithmetic. Tolerances allow for per-line rounding (one haléř/cent per line).
  const lines = doc.lines;
  if (!lines.length) out.push({ code: 'noLines', severity: 'error' });
  for (const l of lines) {
    if (l.quantity === undefined || l.unitPrice === undefined || l.net === undefined) continue;
    const expected = round2(l.quantity * l.unitPrice);
    // Unit prices may carry more decimals than the line amount: allow half a unit of the last place per piece.
    if (!near(expected, l.net, Math.max(0.01, Math.abs(l.quantity) * 0.005))) {
      out.push({ code: 'lineAmountMismatch', severity: 'warning', value: l.id, expected, actual: l.net });
    }
  }
  const tol = 0.01 * (lines.length + 1);
  const netLines = lines.filter((l) => l.net !== undefined);
  if (netLines.length && netLines.length === lines.length && doc.totals.taxExclusive !== undefined) {
    const sum = round2(netLines.reduce((a, l) => a + l.net!, 0));
    if (!near(sum, doc.totals.taxExclusive, tol)) out.push({ code: 'linesTotalMismatch', severity: 'error', expected: sum, actual: doc.totals.taxExclusive });
  }
  for (const t of doc.taxSubTotals) {
    if (t.taxable === undefined || t.tax === undefined || t.percent === undefined) continue;
    const expected = round2((t.taxable * t.percent) / 100);
    if (!near(expected, t.tax, tol)) out.push({ code: 'subtotalVatMismatch', severity: 'error', value: String(t.percent), expected, actual: t.tax });
  }
  const subTax = doc.taxSubTotals.filter((t) => t.tax !== undefined);
  if (subTax.length && doc.taxTotal !== undefined) {
    const sum = round2(subTax.reduce((a, t) => a + t.tax!, 0));
    if (!near(sum, doc.taxTotal, 0.01)) out.push({ code: 'vatTotalMismatch', severity: 'error', expected: sum, actual: doc.taxTotal });
  }
  const { taxExclusive, taxInclusive, payable } = doc.totals;
  if (taxExclusive !== undefined && taxInclusive !== undefined) {
    const expected = round2(taxExclusive + (doc.taxTotal ?? 0));
    if (!near(expected, taxInclusive, 0.01)) out.push({ code: 'inclusiveMismatch', severity: 'error', expected, actual: taxInclusive });
  }
  if (taxInclusive !== undefined && payable !== undefined) {
    // ISDOC: PayableAmount = TaxInclusiveAmount − AlreadyClaimedTaxInclusiveAmount − PaidDepositsAmount + PayableRoundingAmount.
    const expected = round2(taxInclusive - (doc.totals.alreadyClaimed ?? 0) - (doc.totals.paidDeposits ?? 0) + (doc.totals.rounding ?? 0));
    if (!near(expected, payable, 0.01)) out.push({ code: 'payableMismatch', severity: 'error', expected, actual: payable });
  }

  for (const d of [doc.issueDate, doc.taxPointDate, doc.dueDate]) if (d && !isDate(d)) out.push({ code: 'invalidDate', severity: 'error', value: d });
  if (isDate(doc.issueDate) && isDate(doc.dueDate) && doc.dueDate! < doc.issueDate!) {
    out.push({ code: 'dueBeforeIssue', severity: 'warning', value: doc.dueDate });
  }

  // A non-payer charges no VAT (§2 ZDPH / §2 ZoDPH apply to payers only).
  if (scenario.vatStatus === 'non_payer' && ((doc.taxTotal ?? 0) !== 0 || doc.taxSubTotals.some((t) => (t.tax ?? 0) !== 0))) {
    out.push({ code: 'vatOnNonPayer', severity: 'error', actual: doc.taxTotal });
  }
  if (scenario.document === 'simplified' && taxInclusive !== undefined) {
    const limit = SIMPLIFIED_LIMIT[scenario.country];
    if ((doc.localCurrency ?? limit.currency) === limit.currency && Math.abs(taxInclusive) > limit.amount) {
      out.push({ code: 'simplifiedOverLimit', severity: 'error', expected: limit.amount, actual: taxInclusive });
    }
  }
  return out;
}

/** The checklist for the (inferred or given) scenario, each item marked from the file, plus the findings. */
export function checkIsdoc(doc: ParsedIsdoc, scenario: ChecklistScenario = inferIsdocScenario(doc)): IsdocCheck {
  const checklist = invoiceChecklist(scenario);
  const notes = doc.notes.join('\n');
  const items = checklist.items.map((item): IsdocCheckedItem => {
    let status = itemStatus(item.id, doc, notes);
    // An absent conditional or recommended item ("if registered", "if the buyer has a DIČ") is not an error.
    if (status === 'missing' && (item.level !== 'required' || item.note?.startsWith('if'))) status = 'unknown';
    return { ...item, status };
  });
  return { checklist, items, findings: isdocFindings(doc, checklist.scenario) };
}
