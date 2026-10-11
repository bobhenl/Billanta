import type { ParsedBankTransactionRow } from "./csv-parser";

/**
 * Minimal client for the Fio banka read-only API
 * (https://www.fio.cz/docs/cz/API_Bankovnictvi.pdf). The account owner
 * generates a 64-character token in Fio internet banking; with a "jen
 * pohyby" (read-only) token nothing can be paid from the account.
 *
 * Fio allows one request per token every 30 seconds and answers 409 when it
 * is called sooner.
 */
export const FIO_TOKEN_PATTERN = /^[A-Za-z0-9]{64}$/;
export const FIO_MIN_INTERVAL_MS = 30_000;

export interface FioSyncedRow extends ParsedBankTransactionRow {
  /** Fio "ID pohybu" (column22), unique per account. */
  externalId: string;
}

export interface FioStatement {
  accountNumber: string | null;
  rows: FioSyncedRow[];
}

export class FioApiError extends Error {
  constructor(
    message: string,
    readonly code: "rate_limited" | "invalid_token" | "unavailable" | "bad_response",
  ) {
    super(message);
  }
}

type FioColumn = { value: string | number | null } | null | undefined;
type FioTransaction = Record<string, FioColumn>;

function columnText(tx: FioTransaction, id: number): string | null {
  const value = tx[`column${id}`]?.value;
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** "2026-09-30+0200" → that calendar day at UTC midnight (same as CSV import). */
function parseFioDate(raw: string | null): Date | null {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * Maps a Fio `transactions.json` body to rows. Keeps incoming payments only
 * (positive amount): outgoing ones never pay an invoice and would just fill
 * the review list. Rows without an id or date are skipped.
 */
export function parseFioStatement(body: unknown): FioStatement {
  const statement = (body as { accountStatement?: unknown } | null)?.accountStatement as
    | {
        info?: { accountId?: string | number | null; bankId?: string | null; currency?: string | null };
        transactionList?: { transaction?: FioTransaction[] | null } | null;
      }
    | undefined;
  if (!statement) throw new FioApiError("Fio response has no accountStatement", "bad_response");

  const info = statement.info ?? {};
  const accountNumber = info.accountId ? `${info.accountId}${info.bankId ? `/${info.bankId}` : ""}` : null;
  const defaultCurrency = (info.currency ?? "CZK").toUpperCase();
  const transactions = statement.transactionList?.transaction ?? [];

  const rows: FioSyncedRow[] = [];
  for (const tx of transactions) {
    const externalId = columnText(tx, 22);
    const transactionDate = parseFioDate(columnText(tx, 0));
    const amount = Number(tx.column1?.value);
    if (!externalId || !transactionDate || !Number.isFinite(amount) || amount <= 0) continue;

    const account = columnText(tx, 2);
    const bankCode = columnText(tx, 3);
    const variableSymbol = columnText(tx, 5);
    rows.push({
      externalId: `fio:${externalId}`,
      transactionDate,
      amount: amount.toFixed(2),
      currency: (columnText(tx, 14) ?? defaultCurrency).toUpperCase().slice(0, 3),
      // Fio sends VS as text; keep digits only and respect invoices.variable_symbol's length.
      variableSymbol: variableSymbol ? variableSymbol.replace(/\D/g, "").slice(0, 10) || null : null,
      counterpartyAccount: account ? (bankCode ? `${account}/${bankCode}` : account) : null,
      counterpartyName: columnText(tx, 10) ?? columnText(tx, 7),
    });
  }
  return { accountNumber, rows };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Downloads movements between `from` and `to` (inclusive, by day). */
export async function fetchFioStatement(
  token: string,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<FioStatement> {
  const base = (process.env.FIO_API_BASE_URL ?? "https://fioapi.fio.cz/v1/rest").replace(/\/$/, "");
  const url = `${base}/periods/${encodeURIComponent(token)}/${isoDay(from)}/${isoDay(to)}/transactions.json`;

  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new FioApiError("Fio API is not reachable", "unavailable");
  }
  if (response.status === 409) throw new FioApiError("Fio allows one request per 30 seconds", "rate_limited");
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new FioApiError("Fio rejected the token", "invalid_token");
  }
  if (!response.ok) throw new FioApiError(`Fio API answered ${response.status}`, "unavailable");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FioApiError("Fio response is not JSON", "bad_response");
  }
  return parseFioStatement(body);
}
