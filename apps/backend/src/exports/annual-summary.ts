/**
 * The yearly maths moved to `@faktur/cz-compliance` (osvc-annual.ts) so the
 * public calculator on the marketing site uses the very same constants. The
 * old names stay here for the exports module and its spec.
 */
import { advanceTotalFor, type TaxAdvancePeriod } from "@faktur/cz-compliance";

export {
  OSVC_YEAR_PARAMS as YEAR_PARAMS,
  OSVC_FLAT_EXPENSE_CAPS as FLAT_RATES,
  osvcParamsFor as paramsFor,
  computeOsvcAnnualSummary as computeAnnualSummary,
  type OsvcYearParams as YearParams,
  type OsvcFlatRate as FlatRate,
  type OsvcAnnualInput as AnnualSummaryInput,
  type OsvcAnnualSummary as AnnualSummary,
} from "@faktur/cz-compliance";

/** Which day makes income count for a year: paid (daňová evidence) or DUZP (účetnictví). */
export type AccountingBasis = "cash" | "accrual";

/**
 * Paid social / health advances for the summary: a typed amount wins,
 * otherwise the advances from Settings for the 12 months of the year (each
 * month with the amount that applied then). `source` says which one was used.
 */
export function paidAdvances(
  list: readonly TaxAdvancePeriod[],
  year: number,
  typed: { paidSocial?: number; paidHealth?: number },
): { paidSocial?: number; paidHealth?: number; source: Record<"social" | "health", "input" | "settings" | null> } {
  const pick = (kind: "social" | "health", value: number | undefined) => {
    if (value != null) return { value, source: "input" as const };
    const fromSettings = advanceTotalFor(list, kind, year);
    return fromSettings == null ? { value: undefined, source: null } : { value: fromSettings, source: "settings" as const };
  };
  const social = pick("social", typed.paidSocial);
  const health = pick("health", typed.paidHealth);
  return { paidSocial: social.value, paidHealth: health.value, source: { social: social.source, health: health.source } };
}
