import { computeCssz, computeDpfo, computeHealth, type AccountingBasis } from './annual-filings.js';
import type { OsvcFlatRate } from './osvc-annual.js';
import { computeTaxReturnBasis, type TaxReturnCountry } from './tax-return-basis.js';
import type { TaxReturnReport } from './tax-return-files.js';
import type { VatSubmitter } from './vat-returns.js';
import { isSealed } from './vault/confidential.js';
import type { DocumentAmounts } from './vault-amounts.js';

/*
 * The year's reports with sealed amounts (Důvěrný režim, category
 * "amounts"): roční přehled, podklady pro DAP, DPFO and the přehledy for
 * ČSSZ and ZP. Only issued invoices can be sealed, never expenses, so all
 * of them need just one number the server cannot make: the income. The
 * server sums the plain documents and sends each sealed one with its
 * envelope and the conversion rate it picked; the browser opens them, adds
 * them with the same formula and runs the same calculations. A document
 * that stays shut means no report: a return that looks complete and is
 * short would be worse than none.
 */

/** A sealed document of the year: its totals envelope and the rate into the home currency (null: no rate found). */
export interface SealedIncomeDoc {
  encAmounts: string;
  documentType: 'invoice' | 'proforma' | 'credit_note' | 'quote';
  rate: number | null;
}

/** What the server knows about the year's income. */
export interface YearIncomeInputs {
  vatPayer: boolean;
  /** The plain documents' income, home currency, not yet rounded or floored at 0. */
  plainIncome: number;
  counts: { invoices: number; expenses: number; missingRates: number };
  sealedDocs: SealedIncomeDoc[];
}

/**
 * One document's income for the year: without VAT for a VAT payer, with it
 * otherwise, converted to the home currency, a credit note subtracted. The
 * server's sum of plain documents and the browser's of sealed ones both
 * use this.
 */
export function annualIncomeOf(totals: Pick<DocumentAmounts, 'totalWithoutVat' | 'totalWithVat'>, documentType: string, rate: number, vatPayer: boolean): number {
  const amount = vatPayer ? totals.totalWithoutVat : totals.totalWithVat;
  return Math.abs(amount) * rate * (documentType === 'credit_note' ? -1 : 1);
}

/** Every envelope the year's inputs need opened. */
export function sealedIncomeEnvelopes(inputs: Pick<YearIncomeInputs, 'sealedDocs'>): string[] {
  return inputs.sealedDocs.flatMap((d) => (isSealed(d.encAmounts) ? [d.encAmounts] : []));
}

/**
 * The plain income plus the opened sealed documents. A sealed document
 * without a rate counts like a plain one without a rate (left out, in
 * `missingRates`); one not opened counts in `missing`.
 */
export function mergeSealedIncome(
  inputs: YearIncomeInputs,
  opened: ReadonlyMap<string, DocumentAmounts>,
): { income: number; counts: YearIncomeInputs['counts']; missing: number } {
  let income = inputs.plainIncome;
  let invoices = inputs.counts.invoices;
  let missingRates = inputs.counts.missingRates;
  let missing = 0;
  for (const doc of inputs.sealedDocs) {
    const totals = opened.get(doc.encAmounts);
    if (!totals) {
      missing++;
      continue;
    }
    invoices++;
    if (doc.rate == null) {
      missingRates++;
      continue;
    }
    income += annualIncomeOf(totals, doc.documentType, doc.rate, inputs.vatPayer);
  }
  return { income, counts: { ...inputs.counts, invoices, missingRates }, missing };
}

/** The tax-return basis apart from the income (`GET /exports/tax-return-basis-inputs`). */
export interface TaxReturnInputs extends YearIncomeInputs {
  country: TaxReturnCountry;
  year: number;
  legalEntity: boolean;
  flatRate: OsvcFlatRate;
  paidSocial?: number;
  paidHealth?: number;
  expensesByCategory: Record<string, number>;
  companyName: string;
  basis: AccountingBasis;
  flatTaxRegime: boolean;
}

/** The report of the tax-return basis for a given income; the server and the browser both build it here. */
export function taxReturnReportOf(
  inputs: Omit<TaxReturnInputs, 'plainIncome' | 'sealedDocs' | 'counts'>,
  income: number,
  counts: YearIncomeInputs['counts'],
): TaxReturnReport {
  const b = computeTaxReturnBasis({
    country: inputs.country,
    year: inputs.year,
    income,
    expensesByCategory: inputs.expensesByCategory,
    vatPayer: inputs.vatPayer,
    legalEntity: inputs.legalEntity,
    flatRate: inputs.flatRate,
    paidSocial: inputs.paidSocial,
    paidHealth: inputs.paidHealth,
  });
  return { ...b, companyName: inputs.companyName, basis: inputs.basis, vatPayer: inputs.vatPayer, flatTaxRegime: inputs.flatTaxRegime, counts };
}

/** The tax-return basis with the sealed income opened; `report` is null while any document is missing. */
export function buildSealedTaxReturn(inputs: TaxReturnInputs, opened: ReadonlyMap<string, DocumentAmounts>): { report: TaxReturnReport | null; missing: number } {
  const merged = mergeSealedIncome(inputs, opened);
  if (merged.missing > 0) return { report: null, missing: merged.missing };
  return { report: taxReturnReportOf(inputs, merged.income, merged.counts), missing: 0 };
}

/** The figures the year's filings are computed from, apart from the income. */
export interface FilingFigures {
  year: number;
  actualExpenses: number;
  flatRate: OsvcFlatRate | null;
  basis: AccountingBasis;
  activity: 'H' | 'V';
  /** Months with the activity (default all twelve). */
  months?: number[];
  taxAdvancesPaid?: number;
  spouseCredit?: boolean;
  /** Social / health advances paid for the year (0 when unknown). */
  paidSocial: number;
  paidHealth: number;
}

/** DPFO lines, přehled ČSSZ and the health přehled for a given income; shared by the server and the browser. */
export function annualFilingLinesOf(f: FilingFigures, income: number) {
  const months = f.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const dpfo = computeDpfo({
    year: f.year,
    // To the haléř first, as the year summary reports it (computeDpfo floors at 0 and rounds to crowns).
    income: Math.round(income * 100) / 100,
    actualExpenses: f.actualExpenses,
    flatRate: f.flatRate,
    basis: f.basis,
    taxAdvancesPaid: f.taxAdvancesPaid,
    spouseCredit: f.spouseCredit,
    months: months.length,
  });
  // ř. 113 of the DAP is the base for both přehledy.
  const profit = Math.max(0, dpfo.rows.r113);
  const cssz = computeCssz({ year: f.year, profit, activity: f.activity, months, paidAdvances: f.paidSocial });
  const health = computeHealth({ year: f.year, profit, months: months.length, paidAdvances: f.paidHealth });
  return { dpfo, cssz, health };
}

export type AnnualFilingLines = ReturnType<typeof annualFilingLinesOf>;

/** What `GET /exports/annual-filings-inputs` returns. */
export interface AnnualFilingsInputs extends YearIncomeInputs {
  figures: FilingFigures;
  /** The company as the filer, for the XML header. */
  submitter: VatSubmitter;
  paidSource: Record<'social' | 'health', 'input' | 'settings' | null>;
  forms: { dpfdp: string | null; cssz: boolean };
  insurers: readonly { code: string; name: string }[];
}

/** The filings' lines with the sealed income opened; `lines` is null while any document is missing. */
export function buildSealedFilingLines(
  inputs: AnnualFilingsInputs,
  opened: ReadonlyMap<string, DocumentAmounts>,
): { lines: AnnualFilingLines | null; counts: YearIncomeInputs['counts']; missing: number } {
  const merged = mergeSealedIncome(inputs, opened);
  if (merged.missing > 0) return { lines: null, counts: merged.counts, missing: merged.missing };
  return { lines: annualFilingLinesOf(inputs.figures, merged.income), counts: merged.counts, missing: 0 };
}

/**
 * The formats the filing person data must have, checked by the server's
 * POST routes and by the browser before it writes them into a file itself.
 */
export const FILING_PERSON_PATTERNS = {
  birthNumber: /^\d{6}\/?\d{3,4}$/,
  birthDate: /^\d{4}-\d{2}-\d{2}$/,
  dataBox: /^[a-z0-9]{7}$/i,
  variableSymbol: /^\d{1,10}$/,
  ossz: /^\d{3}$/,
} as const;
