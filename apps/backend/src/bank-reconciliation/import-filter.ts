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
