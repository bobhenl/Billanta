/**
 * Base and VAT of one expense.
 *
 * A normal received invoice is stored with its gross amount, so the base is
 * split out of it. In domestic reverse charge (§ 92a ZDPH) the supplier
 * charges no VAT: the stored amount is already the base and the company
 * self-assesses VAT on top of it at `ratePercent` (§ 92a odst. 1, DPHDP3
 * ř. 10/11). It also claims the same amount back as a deduction (ř. 43/44),
 * so the cost of the expense is the base in both cases.
 */
export function expenseVatParts(amount: number, ratePercent: number, reverseCharge: boolean): { base: number; vat: number } {
  if (reverseCharge) return { base: amount, vat: (amount * ratePercent) / 100 };
  const base = amount / (1 + ratePercent / 100);
  return { base, vat: amount - base };
}
