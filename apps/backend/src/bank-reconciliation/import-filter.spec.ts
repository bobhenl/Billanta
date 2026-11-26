import { describe, expect, it } from "vitest";
import { filterWords, passesImportFilter } from "./import-filter";

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
