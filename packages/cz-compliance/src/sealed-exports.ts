import type { HomeCurrency } from './home-currency.js';
import { invoicesCsvBody, type CsvInvoiceRow, type CsvTotals } from './invoices-csv.js';
import { buildCzVatFiling, buildSkVatFiling, vatPartsOf, type CzVatFilingKind, type FilingIssuedDoc, type SkVatFilingKind } from './vat-filing-files.js';
import type { VatExportWarning, VatPeriod, VatReceivedDoc, VatSubmitter } from './vat-returns.js';
import type { SkSubmitter } from './vat-returns-sk.js';
import type { DocumentAmounts } from './vault-amounts.js';

/*
 * Accountant CSV and VAT filings with sealed amounts (Důvěrný režim, category
 * "amounts"). The server cannot sum those documents, so instead of the file
 * it sends everything else it knows (plain documents with their totals,
 * sealed ones with their envelope and, for the filings, the conversion
 * rate). The browser opens the envelopes and runs the same builders. If any
 * document stays shut the file is not built: one missing invoice would make
 * a filing that looks right and is wrong.
 */

type Wire<T> = { [P in keyof T]: T[P] extends Date ? string : T[P] };

/** One row of the CSV inputs: plain with `totals`, or sealed with `encAmounts` and no totals. */
export type SealedCsvRow = Omit<CsvInvoiceRow, 'totals'> & { totals: CsvTotals | null; encAmounts: string | null };

/** What `GET /exports/invoices-csv-inputs` returns. */
export interface SealedCsvInputs {
  home: HomeCurrency;
  companyVars: { key: string; value: string }[];
  rows: SealedCsvRow[];
}

/** Every sealed envelope the inputs need opened. */
export function sealedEnvelopesOf(inputs: { rows: { encAmounts: string | null }[] } | { issued: { encAmounts?: string | null }[] }): string[] {
  const list = 'rows' in inputs ? inputs.rows : inputs.issued;
  return list.flatMap((r) => (r.encAmounts ? [r.encAmounts] : []));
}

/** The accountant's CSV with the opened sealed totals, in the server's order. `body` is null while anything is missing. */
export function buildSealedInvoicesCsv(inputs: SealedCsvInputs, opened: ReadonlyMap<string, DocumentAmounts>): { body: string | null; missing: number } {
  const rows: CsvInvoiceRow[] = [];
  let missing = 0;
  for (const { encAmounts, totals, ...row } of inputs.rows) {
    const found = encAmounts ? opened.get(encAmounts) : totals;
    if (!found) {
      missing++;
      continue;
    }
    rows.push({ ...row, totals: found });
  }
  if (missing > 0) return { body: null, missing };
  return { body: invoicesCsvBody(rows, inputs.companyVars, inputs.home), missing: 0 };
}

/** An issued document of the filing inputs. A sealed one has no parts yet, its envelope and the rate to convert with. */
export type SealedVatIssuedDoc = Wire<FilingIssuedDoc> & { encAmounts?: string | null; rate?: number };

/** What `GET /exports/vat-inputs` returns. */
export type SealedVatInputs = {
  period: VatPeriod;
  issued: SealedVatIssuedDoc[];
  received: Wire<VatReceivedDoc>[];
} & (
  | { country: 'CZ'; kind: CzVatFilingKind; identified: boolean; submitter: VatSubmitter }
  | { country: 'SK'; kind: SkVatFilingKind; submitter: SkSubmitter }
);

/**
 * The VAT filing with the opened sealed documents converted at the rate the
 * server picked for them (stored, or ČNB/ECB of the tax point), exactly as
 * the server converts its plain ones. `body` is null when nothing is due, or
 * while `missing` is above 0.
 */
export function buildSealedVatFiling(
  inputs: SealedVatInputs,
  opened: ReadonlyMap<string, DocumentAmounts>,
  today?: Date,
): { body: string | null; warnings: VatExportWarning[]; missing: number } {
  const issued: FilingIssuedDoc[] = [];
  let missing = 0;
  for (const { encAmounts, rate, ...doc } of inputs.issued) {
    const base = { ...doc, taxableDate: new Date(doc.taxableDate) };
    if (!encAmounts) {
      issued.push(base);
      continue;
    }
    const totals = opened.get(encAmounts);
    if (!totals || rate == null) {
      missing++;
      continue;
    }
    issued.push({ ...base, ...vatPartsOf(totals, rate) });
  }
  if (missing > 0) return { body: null, warnings: [], missing };
  const received = inputs.received.map((d) => ({ ...d, taxableDate: new Date(d.taxableDate) }));
  if (inputs.country === 'SK') {
    return { body: buildSkVatFiling(inputs.kind, { issued, received, submitter: inputs.submitter, period: inputs.period, today }), warnings: [], missing: 0 };
  }
  const { body, warnings } = buildCzVatFiling(inputs.kind, {
    issued,
    received,
    submitter: inputs.submitter,
    period: inputs.period,
    identified: inputs.identified,
    today,
  });
  return { body, warnings, missing: 0 };
}
