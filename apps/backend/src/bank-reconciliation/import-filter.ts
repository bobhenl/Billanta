import type { ParsedBankTransactionRow } from "./csv-parser";

/** The words of a connection's import filter; empty when it keeps everything. */
export function filterWords(filter: string | null | undefined): string[] {
  return (filter ?? "")
    .split(/[,\n;]/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether a movement from a filtered (typically personal) account may be
 * stored: its counterparty, account or message contains one of the words.
 * Everything else never leaves the bank's answer.
 */
export function passesImportFilter(row: ParsedBankTransactionRow, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = [row.counterpartyName, row.counterpartyAccount, row.message].filter(Boolean).join(" ").toLowerCase();
  return words.some((w) => text.includes(w));
}

/**
 * The words typed next to "Nahrát výpis" (a personal account's statement
 * where only the ad spend matters). At most 20, so a pasted list can't turn
 * every row into a long scan. Rows without any of them are never stored.
 */
export function filterUploadedRows<T extends ParsedBankTransactionRow>(rows: T[], keywords: string | null | undefined): { rows: T[]; filteredOut: number } {
  const words = filterWords(keywords?.slice(0, 500)).slice(0, 20);
  if (words.length === 0) return { rows, filteredOut: 0 };
  const kept = rows.filter((r) => passesImportFilter(r, words));
  return { rows: kept, filteredOut: rows.length - kept.length };
}
