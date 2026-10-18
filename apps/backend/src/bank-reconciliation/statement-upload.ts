import { BadRequestException } from "@nestjs/common";
import {
  BankStatementParseError,
  detectBankStatementFormat,
  parseCamt053,
  parseGpc,
  type ParsedBankStatement,
} from "@faktur/cz-compliance";
import { decodeBankStatement, parseBankStatementCsv, type ParsedBankTransactionRow } from "./csv-parser";

export const STATEMENT_EXTENSIONS = [".csv", ".xml", ".gpc", ".abo"] as const;

export interface UploadedStatementRow extends ParsedBankTransactionRow {
  externalId: string | null;
}

/** bank_transactions.external_id is varchar(300). */
const EXTERNAL_ID_MAX = 300;

export function hasStatementExtension(filename: string): boolean {
  const name = filename.toLowerCase();
  return STATEMENT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Incoming payments of a parsed camt.053 / GPC statement as rows for
 * `persistAndMatch`. Outgoing ones are left out, as in the Fio sync: they
 * never pay an invoice. The id is namespaced by format and account, so the
 * same bank reference in another account's statement stays distinct.
 */
export function statementToRows(statement: ParsedBankStatement): UploadedStatementRow[] {
  return statement.entries
    .filter((entry) => entry.direction === "credit")
    .map((entry) => {
      const [y, m, d] = entry.bookingDate.split("-").map(Number);
      return {
        transactionDate: new Date(Date.UTC(y, m - 1, d)),
        amount: entry.amount,
        currency: entry.currency,
        variableSymbol: entry.variableSymbol,
        counterpartyAccount: entry.counterpartyAccount,
        counterpartyName: entry.counterpartyName,
        message: entry.message,
        externalId: entry.bankReference
          ? `${statement.format}:${statement.accountNumber ?? ""}:${entry.bankReference}`.slice(0, EXTERNAL_ID_MAX)
          : null,
      };
    });
}

/**
 * Detects the format of an uploaded statement and parses it. Parse errors
 * become a 400 with the stable code `bank_statement_invalid` and the
 * row-level problems, like the CSV parser's errors.
 */
export function parseUploadedStatement(
  filename: string,
  file: Buffer,
): { source: "csv" | "camt053" | "gpc"; rows: UploadedStatementRow[] } {
  // GPC is CP1250, camt is UTF-8 by its XML declaration, CSV either; the decoder tries UTF-8 first.
  const content = decodeBankStatement(file);
  const format = detectBankStatementFormat(filename, content);
  if (format === null) throw new BadRequestException("bank_statement_unknown_format");
  if (format === "csv") {
    return { source: "csv", rows: parseBankStatementCsv(content).map((row) => ({ ...row, externalId: null })) };
  }
  try {
    const statement = format === "camt053" ? parseCamt053(content) : parseGpc(content);
    return { source: format, rows: statementToRows(statement) };
  } catch (error) {
    if (error instanceof BankStatementParseError) {
      throw new BadRequestException({ message: "bank_statement_invalid", detail: error.message, errors: error.errors });
    }
    throw error;
  }
}
