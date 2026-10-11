/**
 * Amount placeholders (`{base}`, `{vat}`, `{paid}`, `{remaining}`, `{net}`,
 * `{tax}`, `{social}`, `{health}`, `{insurance}`) for notes, e-mails and custom
 * fields. They need the computed totals, so they are filled next to `{amount}`
 * wherever a document is rendered. The maths lives in ./custom-fields.
 */
import { burdenOf, formattedVars, numericVars, NET_FLAT_RATE, type DocTotals } from "./custom-fields";

export { NET_FLAT_RATE, displayCustomField, resolveVars, type CustomField } from "./custom-fields";

export function netAfterTaxes(base: number, flatRate = NET_FLAT_RATE): number {
  return burdenOf(base, flatRate).net;
}

export function amountValues(
  totals: DocTotals,
  amountPaid: number | string | null | undefined,
  format: (n: number) => string,
): Record<string, string> {
  return formattedVars(numericVars(totals, amountPaid), format);
}
