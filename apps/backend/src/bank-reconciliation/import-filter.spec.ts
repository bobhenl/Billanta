import { describe, expect, it } from "vitest";
import { filterUploadedRows, filterWords, passesImportFilter } from "./import-filter";

const row = (over: Partial<Parameters<typeof passesImportFilter>[0]> = {}) => ({
  transactionDate: new Date("2026-11-20"),
  amount: "-1200.00",
  currency: "CZK",
  variableSymbol: null,
  counterpartyAccount: null,
  counterpartyName: null,
  message: null,
  ...over,
});

describe("import filter", () => {
  it("splits on commas, semicolons and lines, ignoring case and blanks", () => {
    expect(filterWords(" Google ,ADS;\n\n Meta ")).toEqual(["google", "ads", "meta"]);
    expect(filterWords(null)).toEqual([]);
  });

  it("keeps everything without words", () => {
    expect(passesImportFilter(row({ counterpartyName: "Grandma" }), [])).toBe(true);
  });

  it("keeps a movement whose name, account or message has a word", () => {
    const words = filterWords("google");
    expect(passesImportFilter(row({ counterpartyName: "GOOGLE *ADS1234" }), words)).toBe(true);
    expect(passesImportFilter(row({ message: "Google Ads invoice" }), words)).toBe(true);
    expect(passesImportFilter(row({ counterpartyAccount: "google-billing" }), words)).toBe(true);
  });

  it("drops a personal movement that has none", () => {
    expect(passesImportFilter(row({ counterpartyName: "Albert", message: "groceries" }), filterWords("google, meta"))).toBe(false);
  });
});

describe("filterUploadedRows", () => {
  const row = (counterpartyName: string | null, message: string | null) =>
    ({ transactionDate: new Date("2026-10-01"), amount: "-152.00", currency: "CZK", counterpartyName, counterpartyAccount: null, message, variableSymbol: null }) as never;
  const rows = [row("Google Ads", "Google Ads"), row(null, "Grab"), row(null, "GOOGLE *Workspace"), row("Lidl", null)];

  it("keeps every row when no words are given", () => {
    expect(filterUploadedRows(rows, "  ")).toEqual({ rows, filteredOut: 0 });
    expect(filterUploadedRows(rows, undefined)).toEqual({ rows, filteredOut: 0 });
  });

  it("keeps rows whose counterparty or message holds one of the words, case-insensitively", () => {
    const out = filterUploadedRows(rows, "google; lidl");
    expect(out.rows).toEqual([rows[0], rows[2], rows[3]]);
    expect(out.filteredOut).toBe(1);
  });

  it("reads at most 20 words", () => {
    const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(",") + ",grab";
    expect(filterUploadedRows(rows, many).rows).toEqual([]);
  });
});
