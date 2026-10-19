import { decodeCsvBuffer, parseCsv } from "../contacts/contacts-csv.util";
import { isLegacyXls, isXlsx, readXlsx } from "./xlsx-read";

/** Why an uploaded table could not be read; the code goes to the client as is. */
export class TableFileError extends Error {
  constructor(readonly code: "xls_unsupported" | "xlsx_unreadable") {
    super(code);
  }
}

/** An uploaded CSV or .xlsx as rows of strings (first row = header), told apart by content, not name. */
export function readTableFile(buf: Buffer): string[][] {
  if (isLegacyXls(buf)) throw new TableFileError("xls_unsupported");
  if (isXlsx(buf)) {
    try {
      return readXlsx(buf);
    } catch {
      throw new TableFileError("xlsx_unreadable");
    }
  }
  return parseCsv(decodeCsvBuffer(buf));
}
