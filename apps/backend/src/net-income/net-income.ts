/*
 * The net-income math lives in @faktur/cz-compliance so the browser builds
 * the same report when amounts are sealed. The backend keeps its old names.
 */
export {
  allocateWholeKc as allocate,
  computeNetIncome,
  partnerSplitOf as splitOf,
  sharedExpenseAmount,
  type NetIncomeItem as IncomeItem,
  type NetIncomeLine,
  type NetIncomePartnerLine as PartnerLine,
  type NetIncomeResult,
  type NetIncomeSpan as Span,
} from "@faktur/cz-compliance";
