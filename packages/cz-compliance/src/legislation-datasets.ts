/**
 * Groups of constants that are re-checked against official pages, and the
 * day each was last checked by hand. The backend's weekly legislation
 * monitor moves a group's date forward whenever all of its pages are seen
 * unchanged; these static dates are the fallback when that is unavailable
 * (build time, backend down), so a page never shows "never checked".
 */
export const LEGISLATION_DATASETS = ['vat_forms', 'dpfo_form', 'cssz_form', 'osvc_minimums', 'flat_tax'] as const;
export type LegislationDataset = (typeof LEGISLATION_DATASETS)[number];

/** Last manual check per group (YYYY-MM-DD). */
export const DATASET_CHECKED: Record<LegislationDataset, string> = {
  // EPO form list (DPHDP3, DPHKH1, DPHSHV): vat-filing.ts
  vat_forms: '2026-10-17',
  // EPO form list (DPFDP6, DPFDP7): apps/backend annual-filings.ts
  dpfo_form: '2026-10-17',
  // ČSSZ e-podání OSVČ (OSVC2023–2025): apps/backend annual-filings.ts
  cssz_form: '2026-10-17',
  // ČSSZ minimum bases, health minimum: cz-tax-years.ts, tax-minimums.ts
  osvc_minimums: '2026-10-17',
  // Finanční správa, paušální daň: cz-tax-years.ts
  flat_tax: '2026-10-17',
};

/** The later of the monitor's date and the manual one. */
export function datasetChecked(dataset: LegislationDataset, live?: Partial<Record<string, string | null>> | null): string {
  const fromMonitor = live?.[dataset];
  const manual = DATASET_CHECKED[dataset];
  return fromMonitor && /^\d{4}-\d{2}-\d{2}$/.test(fromMonitor) && fromMonitor > manual ? fromMonitor : manual;
}
