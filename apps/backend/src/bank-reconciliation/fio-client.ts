import type { ParsedBankTransactionRow } from "./csv-parser";

/**
 * Minimal client for the Fio banka read-only API
 * (https://www.fio.cz/docs/cz/API_Bankovnictvi.pdf). The account owner
 * generates a 64-character token in Fio internet banking; with a "jen
 * pohyby" (read-only) token nothing can be paid from the account.
 *
 * We read with `last`, which returns the movements since Fio's server-side
 * cursor ("zarážka") and moves the cursor past them. `set-last-id` and
 * `set-last-date` put the cursor somewhere else. Fio allows one request per
 * token every 30 seconds, for all of these endpoints together, and answers
 * 409 when it is called sooner.
 *
 * The token is part of every URL path. Nothing here logs a URL, and errors
 * carry a fixed message, so the token never reaches a log line.
 */
export const FIO_TOKEN_PATTERN = /^[A-Za-z0-9]{64}$/;
export const FIO_MIN_INTERVAL_MS = 30_000;
/** Fio serves older movements only after a strong authorisation in internet banking. */
export const FIO_HISTORY_DAYS = 89;
/** How far back the first download goes. */
export const FIO_FIRST_SYNC_DAYS = 30;
/** A cursor set from `lastSyncedAt` overlaps a few days so late-booked movements still arrive. */
const OVERLAP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface FioSyncedRow extends ParsedBankTransactionRow {
  /** Fio "ID pohybu" (column22), unique per account. */
  externalId: string;
}

export interface FioStatement {
  accountNumber: string | null;
  rows: FioSyncedRow[];
  /** Highest movement id in the response, outgoing ones included; null when it has none. */
  lastMovementId: number | null;
  /** `info.idLastDownload`: where Fio's cursor stood (see `fioCursorAfterFetch`). */
  idLastDownload: number | null;
}

export type FioErrorCode = "rate_limited" | "invalid_token" | "history_locked" | "unavailable" | "bad_response";

export class FioApiError extends Error {
  constructor(
    message: string,
    readonly code: FioErrorCode,
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

function idNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
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
        info?: {
          accountId?: string | number | null;
          bankId?: string | null;
          currency?: string | null;
          idLastDownload?: string | number | null;
        };
        transactionList?: { transaction?: FioTransaction[] | null } | null;
      }
    | undefined;
  if (!statement) throw new FioApiError("Fio response has no accountStatement", "bad_response");

  const info = statement.info ?? {};
  const accountNumber = info.accountId ? `${info.accountId}${info.bankId ? `/${info.bankId}` : ""}` : null;
  const defaultCurrency = (info.currency ?? "CZK").toUpperCase();
  const transactions = statement.transactionList?.transaction ?? [];

  const rows: FioSyncedRow[] = [];
  let lastMovementId: number | null = null;
  for (const tx of transactions) {
    const movementId = idNumber(tx.column22?.value);
    if (movementId !== null && (lastMovementId === null || movementId > lastMovementId)) lastMovementId = movementId;

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
      // column16 "Zpráva pro příjemce".
      message: columnText(tx, 16),
    });
  }
  return { accountNumber, rows, lastMovementId, idLastDownload: idNumber(info.idLastDownload) };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function baseUrl(): string {
  return (process.env.FIO_API_BASE_URL ?? "https://fioapi.fio.cz/v1/rest").replace(/\/$/, "");
}

async function fioGet(path: string, fetchImpl: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl()}/${path}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new FioApiError("Fio API is not reachable", "unavailable");
  }
  if (response.status === 409) throw new FioApiError("Fio allows one request per 30 seconds", "rate_limited");
  if (response.status === 422) throw new FioApiError("Fio needs a strong authorisation for this history", "history_locked");
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new FioApiError("Fio rejected the token", "invalid_token");
  }
  if (!response.ok) throw new FioApiError(`Fio API answered ${response.status}`, "unavailable");
  return response;
}

/** Movements since Fio's cursor; Fio moves the cursor past them. */
export async function fetchFioLast(token: string, fetchImpl: typeof fetch = fetch): Promise<FioStatement> {
  const response = await fioGet(`last/${encodeURIComponent(token)}/transactions.json`, fetchImpl);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FioApiError("Fio response is not JSON", "bad_response");
  }
  return parseFioStatement(body);
}

/** Puts Fio's cursor on movement `id`: the next `last` starts right after it. */
export async function setFioLastId(token: string, id: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fioGet(`set-last-id/${encodeURIComponent(token)}/${id}/`, fetchImpl);
}

/** Puts Fio's cursor before `day`: the next `last` starts with that day's movements. */
export async function setFioLastDate(token: string, day: Date, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fioGet(`set-last-date/${encodeURIComponent(token)}/${isoDay(day)}/`, fetchImpl);
}

export interface FioCursorState {
  fioLastId: number | null;
  fioCursorReady: boolean;
  lastSyncedAt: Date | null;
}

export type FioStep = { kind: "set-last-id"; id: number } | { kind: "set-last-date"; day: Date } | { kind: "last" };

/**
 * What the next request for a connection is. Every sync makes exactly one
 * request, so the 30-second limit never splits a step in half:
 *
 * - cursor known → `last`;
 * - cursor unknown but we have stored movements → `set-last-id` to the
 *   highest one, so nothing after it is skipped;
 * - nothing stored yet (new connection, or one from before migration 0063,
 *   or after Fio refused old history) → `set-last-date`, 30 days back on a
 *   first sync, or a few days before the last sync, never past 89 days.
 */
export function planFioStep(state: FioCursorState, now: Date): FioStep {
  if (state.fioCursorReady) return { kind: "last" };
  if (state.fioLastId !== null) return { kind: "set-last-id", id: state.fioLastId };
  const oldest = now.getTime() - FIO_HISTORY_DAYS * DAY_MS;
  const wanted = state.lastSyncedAt
    ? state.lastSyncedAt.getTime() - OVERLAP_DAYS * DAY_MS
    : now.getTime() - FIO_FIRST_SYNC_DAYS * DAY_MS;
  return { kind: "set-last-date", day: new Date(Math.max(oldest, wanted)) };
}

/**
 * The cursor to store after a `last` download. `idLastDownload` should be
 * either our own last id (where the cursor stood) or the response's last
 * id (where it stands now); Fio's documentation does not pin it down, so
 * both are accepted. Anything else means the cursor moved without us:
 * another app using the same token, or an earlier download whose
 * transaction rolled back. Then the stored id stays where it was and the
 * cursor is marked unknown, so the next sync rewinds to it with
 * `set-last-id` and the skipped movements come again (duplicates are
 * dropped by their movement id).
 */
export function fioCursorAfterFetch(
  previousLastId: number | null,
  statement: Pick<FioStatement, "lastMovementId" | "idLastDownload">,
): { fioLastId: number | null; fioCursorReady: boolean } {
  const { lastMovementId, idLastDownload } = statement;
  const drifted =
    previousLastId !== null &&
    idLastDownload !== null &&
    idLastDownload !== previousLastId &&
    idLastDownload !== lastMovementId;
  if (drifted) return { fioLastId: previousLastId, fioCursorReady: false };
  const newest = lastMovementId === null ? previousLastId : Math.max(previousLastId ?? 0, lastMovementId);
  return { fioLastId: newest, fioCursorReady: true };
}
