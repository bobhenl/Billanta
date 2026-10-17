/**
 * Moved to `@faktur/cz-compliance` (osvc-annual.ts) so the public calculator
 * on the marketing site uses the very same constants and maths. The old
 * names stay here for the exports module and its spec.
 */
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
