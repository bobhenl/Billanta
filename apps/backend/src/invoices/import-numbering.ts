import {
  effectiveNumberPattern,
  findNumberPatternClash,
  inferNumberPattern,
  numberPeriod,
  parseDocumentNumber,
  renderDocumentNumber,
  type NumberDocumentType,
  type NumberFormats,
} from "@faktur/cz-compliance";

/**
 * Keeping the numbering row after a move: when the imported numbers are
 * written in a pattern our counters would not continue (`FV2025017` while
 * the company issues `2025-0001`), the preview offers that pattern, so the
 * next invoice is `FV2025018` and the accounting row has no gap.
 */
export interface NumberingSuggestion {
  documentType: NumberDocumentType;
  /** The pattern the imported numbers are written in. */
  pattern: string;
  /** The pattern the company would otherwise use (its own or the built-in one). */
  current: string;
  /** The next number in `pattern` for the current year or month. */
  nextNumber: string;
  /** The company's own (not imported) documents of this type; switching then changes their row. */
  existingDocuments: number;
}

type Numbered = { invoiceNumber: string; documentType: NumberDocumentType; issueDate: Date };

export function numberingSuggestions(
  invoices: Numbered[],
  formats: NumberFormats,
  now = new Date(),
): Omit<NumberingSuggestion, "existingDocuments">[] {
  const byType = new Map<NumberDocumentType, Numbered[]>();
  for (const inv of invoices) byType.set(inv.documentType, [...(byType.get(inv.documentType) ?? []), inv]);
  const out: Omit<NumberingSuggestion, "existingDocuments">[] = [];
  for (const [type, list] of byType) {
    const current = effectiveNumberPattern(formats, type);
    // Numbers our pattern reads already continue (the import bumps that counter).
    if (list.every((inv) => parseDocumentNumber(current, inv.invoiceNumber))) continue;
    const pattern = inferNumberPattern(list.map((inv) => ({ number: inv.invoiceNumber, issueDate: inv.issueDate })));
    if (!pattern || pattern === current) continue;
    const period = numberPeriod(pattern, now);
    let highest = 0;
    for (const inv of list) {
      const parts = parseDocumentNumber(pattern, inv.invoiceNumber);
      if (parts && parts.year === period.year && parts.month === period.month) highest = Math.max(highest, parts.sequence);
    }
    const nextNumber = renderDocumentNumber(pattern, { year: period.year, month: period.month || 1, sequence: highest + 1 });
    out.push({ documentType: type, pattern, current, nextNumber });
  }
  // Two types may not end up sharing one pattern (they would hand out the same numbers).
  const merged: NumberFormats = { ...formats };
  return out.filter((s) => {
    const next = { ...merged, [s.documentType]: s.pattern };
    if (findNumberPatternClash(next)) return false;
    merged[s.documentType] = s.pattern;
    return true;
  });
}
