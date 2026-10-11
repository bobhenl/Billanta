import { BadRequestException } from "@nestjs/common";

/**
 * The bank-statement CSV format this module accepts — see
 * `apps/backend/README.md`'s "Bank reconciliation" section for the
 * user-facing documentation this mirrors. Defined here (rather than copying
 * a specific bank's real export format) because CZ bank CSV exports vary
 * significantly bank-to-bank (Fio, ČSOB, KB, Raiffeisenbank all differ in
 * column names/order/encoding) — this is a plain, explicit contract a
 * tenant (or a small conversion script) can target regardless of which bank
 * they use.
 */
export interface ParsedBankTransactionRow {
  transactionDate: Date;
  /** Decimal string with exactly 2 fraction digits, e.g. "1500.00" — matches
   *  `bank_transactions.amount`'s `numeric(14, 2)` column. */
  amount: string;
  currency: string;
  variableSymbol: string | null;
  counterpartyAccount: string | null;
  counterpartyName: string | null;
}

/** All six columns are required in the header (order doesn't matter — looked
 * up by name); a row may still leave the optional ones blank. */
const REQUIRED_HEADERS = [
  "date",
  "amount",
  "currency",
  "variable_symbol",
  "counterparty_account",
  "counterparty_name",
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** Matches `invoices.variableSymbol`'s `varchar(10)` column — validated here
 * so a too-long value fails with a clear CSV-row error instead of a raw
 * Postgres string-truncation error deep in the insert. */
const MAX_VARIABLE_SYMBOL_LENGTH = 10;

/**
 * Parses the whole file up front and either returns every row or throws
 * with the full list of row-level problems (never inserts partial data —
 * the caller runs this before touching the database, and the request's
 * transaction (see `TenantContextMiddleware`) would roll back anyway if it
 * didn't).
 */
export function parseBankStatementCsv(content: string): ParsedBankTransactionRow[] {
  // Bank-exported CSVs are commonly saved with a UTF-8 BOM (especially from
  // Windows-based banking software) — strip it rather than let it corrupt
  // the first header cell's name.
  const normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = normalized.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new BadRequestException("CSV file is empty");
  }

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const missingHeaders = REQUIRED_HEADERS.filter((name) => !header.includes(name));
  if (missingHeaders.length > 0) {
    throw new BadRequestException(
      `CSV is missing required column(s): ${missingHeaders.join(", ")}. Expected header: ` +
        `${REQUIRED_HEADERS.join(",")} — see apps/backend/README.md "Bank reconciliation" for the full format.`,
    );
  }

  const dateIdx = header.indexOf("date");
  const amountIdx = header.indexOf("amount");
  const currencyIdx = header.indexOf("currency");
  const vsIdx = header.indexOf("variable_symbol");
  const accountIdx = header.indexOf("counterparty_account");
  const nameIdx = header.indexOf("counterparty_name");

  const rows: ParsedBankTransactionRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1; // 1-based — matches what a user sees in a text editor / spreadsheet app.
    const cells = splitCsvLine(lines[i]);

    if (cells.length < header.length) {
      errors.push(`Line ${lineNumber}: expected ${header.length} columns, found ${cells.length}`);
      continue;
    }

    const rawDate = (cells[dateIdx] ?? "").trim();
    const rawAmount = (cells[amountIdx] ?? "").trim();
    const rawCurrency = (cells[currencyIdx] ?? "").trim().toUpperCase();
    const rawVariableSymbol = nullIfEmpty(cells[vsIdx]);

    if (!DATE_PATTERN.test(rawDate)) {
      errors.push(`Line ${lineNumber}: invalid date "${rawDate}" (expected YYYY-MM-DD)`);
      continue;
    }
    const transactionDate = new Date(`${rawDate}T00:00:00.000Z`);
    if (Number.isNaN(transactionDate.getTime())) {
      errors.push(`Line ${lineNumber}: invalid date "${rawDate}"`);
      continue;
    }

    if (rawAmount === "" || Number.isNaN(Number(rawAmount))) {
      errors.push(
        `Line ${lineNumber}: invalid amount "${rawAmount}" (expected a plain decimal number, e.g. 1500.00 or -450.00)`,
      );
      continue;
    }

    if (!CURRENCY_PATTERN.test(rawCurrency)) {
      errors.push(
        `Line ${lineNumber}: invalid currency "${rawCurrency}" (expected a 3-letter ISO 4217 code, e.g. CZK)`,
      );
      continue;
    }

    if (rawVariableSymbol && rawVariableSymbol.length > MAX_VARIABLE_SYMBOL_LENGTH) {
      errors.push(
        `Line ${lineNumber}: variable_symbol "${rawVariableSymbol}" is longer than ` +
          `${MAX_VARIABLE_SYMBOL_LENGTH} characters`,
      );
      continue;
    }

    rows.push({
      transactionDate,
      amount: Number(rawAmount).toFixed(2),
      currency: rawCurrency,
      variableSymbol: rawVariableSymbol,
      counterpartyAccount: nullIfEmpty(cells[accountIdx]),
      counterpartyName: nullIfEmpty(cells[nameIdx]),
    });
  }

  if (errors.length > 0) {
    throw new BadRequestException({
      message: "CSV contains invalid rows — no rows were imported",
      errors,
    });
  }

  if (rows.length === 0) {
    throw new BadRequestException("CSV has a valid header but no data rows");
  }

  return rows;
}

function nullIfEmpty(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Minimal RFC-4180-style line splitter: handles double-quoted fields with
 * embedded commas and `""`-escaped quotes within a quoted field. This is
 * intentionally NOT a full CSV/MT940 parser — MT940 is a fixed-width-ish
 * SWIFT statement format, structurally unrelated to CSV, and out of scope
 * for this MVP (see README) even though `bank_statement_imports.source`
 * already has an `mt940` enum value reserved for it.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
