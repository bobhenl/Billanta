import { BadRequestException } from "@nestjs/common";

/**
 * The bank-statement CSV formats this module accepts – see
 * `apps/backend/README.md`'s "Bank reconciliation" section for the
 * user-facing documentation. Billanta's own format (date, amount, currency,
 * variable_symbol, counterparty_account, counterparty_name) always works;
 * on top of that the usual CZ/SK bank exports are recognised by their
 * column names (Fio, ČSOB, KB, Raiffeisen, Tatra banka…), with `;` or tab
 * delimiters, DD.MM.YYYY dates, decimal commas and a few preamble lines
 * before the header. Anything else needs a small conversion to the plain
 * format.
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
  /** The payer's note, when the source has one. */
  message?: string | null;
}

/**
 * Accepted names for each column, after `normalizeHeader` (lower case, no
 * diacritics, single spaces). The first name is Billanta's own format.
 */
const COLUMN_ALIASES = {
  date: [
    "date",
    "datum",
    "datum zauctovani",
    "datum zauctovania",
    "datum provedeni",
    "datum transakce",
    "datum transakcie",
    "datum pohybu",
    "booking date",
    "transaction date",
  ],
  amount: ["amount", "objem", "castka", "suma", "zauctovana castka", "castka v mene uctu", "objem transakcie"],
  currency: ["currency", "mena"],
  variableSymbol: ["variable_symbol", "vs", "variabilni symbol", "variabilny symbol", "variable symbol"],
  counterpartyAccount: [
    "counterparty_account",
    "protiucet",
    "cislo protiuctu",
    "protiucet/kod banky",
    "ucet protistrany",
    "cislo uctu protistrany",
    "counterparty account",
  ],
  counterpartyName: [
    "counterparty_name",
    "nazev protiuctu",
    "nazov protiuctu",
    "nazev uctu protistrany",
    "nazov uctu protistrany",
    "protistrana",
    "counterparty name",
  ],
  bankCode: ["kod banky", "bank code"],
  message: ["message", "zprava pro prijemce", "sprava pre prijemcu", "zprava", "sprava", "poznamka", "popis transakcie"],
} as const;

type Column = keyof typeof COLUMN_ALIASES;

/** Columns that must be present (looked up by name, order doesn't matter);
 * the others are optional and a row may leave any optional cell blank. */
const REQUIRED_COLUMNS: Column[] = ["date", "amount", "currency"];

/** How many leading lines may be skipped looking for the header. Bank
 * exports (Fio especially) start with a few lines of account details. */
const MAX_PREAMBLE_LINES = 30;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const DOTTED_DATE = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** Matches `invoices.variableSymbol`'s `varchar(10)` column — validated here
 * so a too-long value fails with a clear CSV-row error instead of a raw
 * Postgres string-truncation error deep in the insert. */
const MAX_VARIABLE_SYMBOL_LENGTH = 10;

/**
 * Decodes an uploaded file: UTF-8 when it is valid UTF-8, otherwise
 * Windows-1250, which older Czech and Slovak banking software still uses.
 */
export function decodeBankStatement(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1250").decode(buffer);
  }
}

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

  let headerLine = 0;
  let delimiter = detectDelimiter(lines[0]);
  let columns = mapColumns(splitCsvLine(lines[0], delimiter));
  for (let i = 0; i < Math.min(lines.length, MAX_PREAMBLE_LINES); i++) {
    const d = detectDelimiter(lines[i]);
    const candidate = mapColumns(splitCsvLine(lines[i], d));
    if (candidate.date !== undefined && candidate.amount !== undefined) {
      headerLine = i;
      delimiter = d;
      columns = candidate;
      break;
    }
  }

  const missing = REQUIRED_COLUMNS.filter((name) => columns[name] === undefined);
  if (missing.length > 0) {
    throw new BadRequestException(
      `CSV is missing required column(s): ${missing.map((name) => COLUMN_ALIASES[name][0]).join(", ")}. ` +
        "It needs at least a date, an amount and a currency column (Billanta's names or the ones your bank uses).",
    );
  }

  const headerWidth = Math.max(...Object.values(columns).map((idx) => idx + 1));
  const rows: ParsedBankTransactionRow[] = [];
  const errors: string[] = [];

  for (let i = headerLine + 1; i < lines.length; i++) {
    const lineNumber = i + 1; // 1-based — matches what a user sees in a text editor / spreadsheet app.
    const cells = splitCsvLine(lines[i], delimiter);
    if (cells.every((value) => value.trim() === "")) continue;

    if (cells.length < headerWidth) {
      errors.push(`Line ${lineNumber}: expected ${headerWidth} columns, found ${cells.length}`);
      continue;
    }

    const cell = (name: Column) => {
      const idx = columns[name];
      return idx === undefined ? "" : (cells[idx] ?? "").trim();
    };
    const rawDate = cell("date");
    const rawAmount = cell("amount");
    const rawCurrency = cell("currency").toUpperCase();
    const rawVariableSymbol = nullIfEmpty(cell("variableSymbol"));

    const transactionDate = parseDate(rawDate);
    if (!transactionDate) {
      errors.push(`Line ${lineNumber}: invalid date "${rawDate}" (expected YYYY-MM-DD or DD.MM.YYYY)`);
      continue;
    }

    const amount = parseAmount(rawAmount);
    if (amount === null) {
      errors.push(
        `Line ${lineNumber}: invalid amount "${rawAmount}" (expected a decimal number, e.g. 1500.00, -450,50 or 1 500,00)`,
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

    let counterpartyAccount = nullIfEmpty(cell("counterpartyAccount"));
    const bankCode = nullIfEmpty(cell("bankCode"));
    if (counterpartyAccount && bankCode && !counterpartyAccount.includes("/")) {
      counterpartyAccount = `${counterpartyAccount}/${bankCode}`;
    }

    rows.push({
      transactionDate,
      amount,
      currency: rawCurrency,
      variableSymbol: rawVariableSymbol,
      counterpartyAccount,
      counterpartyName: nullIfEmpty(cell("counterpartyName")),
      message: nullIfEmpty(cell("message")),
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

function normalizeHeader(cell: string): string {
  return cell
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mapColumns(headerCells: string[]): Partial<Record<Column, number>> {
  const names = headerCells.map(normalizeHeader);
  const result: Partial<Record<Column, number>> = {};
  for (const column of Object.keys(COLUMN_ALIASES) as Column[]) {
    const aliases: readonly string[] = COLUMN_ALIASES[column];
    const idx = names.findIndex((name) => aliases.includes(name));
    if (idx >= 0) result[column] = idx;
  }
  return result;
}

/** Picks the delimiter used most often outside quotes in a line; comma when none. */
function detectDelimiter(line: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char]++;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ",";
}

function parseDate(raw: string): Date | null {
  let year: number;
  let month: number;
  let day: number;
  const iso = ISO_DATE.exec(raw);
  const dotted = DOTTED_DATE.exec(raw);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dotted) {
    [day, month, year] = [Number(dotted[1]), Number(dotted[2]), Number(dotted[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31.02. and similar, which Date would silently roll over.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * Accepts "1500.00", "-450,50", "1 500,00", "1.500,00" and "1,500.00"; a
 * trailing currency code ("1500,00 CZK") is ignored.
 */
function parseAmount(raw: string): string | null {
  let value = raw.replace(/[\s  ]/g, "").replace(/[A-Za-z]{3}$/, "");
  if (value === "") return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > lastDot) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    value = value.replace(/,/g, "");
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) return null;
  return Number(value).toFixed(2);
}

/**
 * Minimal RFC-4180-style line splitter: handles double-quoted fields with
 * embedded delimiters and `""`-escaped quotes within a quoted field. This is
 * intentionally NOT a full CSV/MT940 parser — MT940 is a fixed-width-ish
 * SWIFT statement format, structurally unrelated to CSV, and out of scope
 * for this MVP (see README) even though `bank_statement_imports.source`
 * already has an `mt940` enum value reserved for it.
 */
function splitCsvLine(line: string, delimiter = ","): string[] {
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
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
