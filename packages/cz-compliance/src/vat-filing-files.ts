import {
  generateDphDp3,
  generateDphDp3Identified,
  generateDphKh1,
  generateDphShv,
  type VatExportWarning,
  type VatIssuedDoc,
  type VatPeriod,
  type VatRatePart,
  type VatReceivedDoc,
  type VatSubmitter,
} from './vat-returns.js';
import { generateSkDphV25, generateSkKvDphV25, generateSkSvDphV20, type SkSubmitter } from './vat-returns-sk.js';

/*
 * Which generator a VAT filing uses and what it is fed. Shared by the server
 * (plain documents) and the browser (when some documents have sealed amounts
 * that only it can open), so both hand over the same file.
 */

export type CzVatFilingKind = 'dp3' | 'kh1' | 'shv';
export type SkVatFilingKind = 'dph' | 'kv' | 'sv';

/** An issued document for the filings; `correctsNumber` is the invoice a credit note corrects (SK KV C.1). */
export type FilingIssuedDoc = VatIssuedDoc & { correctsNumber: string | null };

/** A document's rate groups and total in the filing currency, at `rate` home units per 1 unit of its currency. */
export function vatPartsOf(
  totals: { totalWithVat: number; byRate: { vatRatePercent: number; totalWithoutVat: number; vatAmount: number }[] },
  rate: number,
): { parts: VatRatePart[]; totalCzk: number } {
  return {
    parts: totals.byRate.map((r) => ({ ratePercent: r.vatRatePercent, base: r.totalWithoutVat * rate, vat: r.vatAmount * rate })),
    totalCzk: totals.totalWithVat * rate,
  };
}

/** A Czech filing (EPO). `body` is null when nothing is due (an identified person's DP3, an empty SHV). */
export function buildCzVatFiling(
  kind: CzVatFilingKind,
  input: { issued: VatIssuedDoc[]; received: VatReceivedDoc[]; submitter: VatSubmitter; period: VatPeriod; identified: boolean; today?: Date },
): { body: string | null; warnings: VatExportWarning[] } {
  const { issued, received, submitter, period, today } = input;
  // Only a monthly DP3 or SHV reaches here for an identified person (the controller checks).
  if (kind === 'dp3' && input.identified && 'month' in period) {
    const { xml, warnings } = generateDphDp3Identified({ issued, received, submitter, period, today });
    return { body: xml, warnings };
  }
  if (kind === 'dp3') return { body: generateDphDp3({ issued, received, submitter, period, today }), warnings: [] };
  if (kind === 'kh1') {
    const { xml, warnings } = generateDphKh1({ issued, received, submitter, period, today });
    return { body: xml, warnings };
  }
  return { body: generateDphShv({ issued, submitter, period, today }), warnings: [] };
}

/** A Slovak filing (DPHv25, KVDPHv25, SVDPHv20) in EUR. Null when there is nothing to report (SV). */
export function buildSkVatFiling(
  kind: SkVatFilingKind,
  input: { issued: FilingIssuedDoc[]; received: VatReceivedDoc[]; submitter: SkSubmitter; period: VatPeriod; today?: Date },
): string | null {
  const issued = input.issued.map((d) => ({
    number: d.number,
    customerVatId: d.customerDic,
    customerCountry: d.customerCountry,
    taxableDate: d.taxableDate,
    reverseCharge: d.reverseCharge,
    parts: d.parts,
    correctsNumber: d.correctsNumber,
  }));
  const received = input.received.map((d) => ({
    number: d.number,
    supplierVatId: d.supplierDic,
    taxableDate: d.taxableDate,
    parts: d.parts,
  }));
  const { submitter, period, today } = input;
  if (kind === 'dph') return generateSkDphV25({ issued, received, submitter, period, today });
  if (kind === 'kv') return generateSkKvDphV25({ issued, received, submitter, period });
  return generateSkSvDphV20({ issued, submitter, period, today });
}
