import type { PaidPlan } from "./plans";

/**
 * Calendar months on an ISO day: 31 Jan + 1 month is 28/29 Feb, not 3 Mar.
 * Postgres `date + make_interval(months => n)` clamps the same way, which is
 * what `mark_platform_proforma_paid` (0051) uses for a paid proforma.
 */
export function addMonths(isoDay: string, months: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * Where a payment for `months` of `plan` takes the prepaid period: on from
 * the end of a running period of the same plan, so paying early loses no
 * days, otherwise from today. `prepaidUntil` is the last day still covered.
 * Mirrors `mark_platform_proforma_paid`; credits (`ReferralsService.redeem`)
 * use it directly.
 */
export function prepaidUntilAfterPayment(
  current: { prepaidPlan: string | null; prepaidUntil: string | null },
  plan: PaidPlan,
  months: number,
  today: string,
): string {
  const running = current.prepaidPlan === plan && current.prepaidUntil !== null && current.prepaidUntil >= today;
  return addMonths(running ? current.prepaidUntil! : today, months);
}
