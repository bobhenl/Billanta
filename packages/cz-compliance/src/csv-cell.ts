/**
 * Cells for the semicolon CSV exports (Czech Excel: decimal comma, `;`).
 *
 * Text that starts like a formula (=, +, -, @, tab, CR) gets a leading ' so
 * Excel and LibreOffice show it instead of running it. Supplier names,
 * expense categories and notes are free text, so a crafted value could
 * otherwise turn the export into a `=HYPERLINK(...)` or DDE payload.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A number as the exports print it: two decimals, decimal comma. */
export const csvNumber = (v: number) => v.toFixed(2).replace(".", ",");

/** A text cell: defused, then quoted when it holds a separator, quote or newline. */
export function csvText(v: string): string {
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Numbers stay numbers (a negative amount must not get the ' prefix); everything else is text. */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  return typeof v === "number" ? csvNumber(v) : csvText(v);
}
