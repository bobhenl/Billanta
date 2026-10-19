import { describe, expect, it } from "vitest";
import { numberingSuggestions } from "./import-numbering";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const inv = (invoiceNumber: string, issueDate: string, documentType: "invoice" | "proforma" | "credit_note" = "invoice") => ({
  invoiceNumber,
  documentType,
  issueDate: d(issueDate),
});

describe("numberingSuggestions", () => {
  const now = new Date(2025, 10, 15);

  it("offers the source's pattern with the next number of this year", () => {
    expect(numberingSuggestions([inv("FV2025017", "2025-03-01"), inv("FV2025018", "2025-10-01"), inv("FV2024230", "2024-12-30")], {}, now)).toEqual([
      { documentType: "invoice", pattern: "FV{YYYY}{NNN}", current: "{YYYY}-{NNNN}", nextNumber: "FV2025019" },
    ]);
  });

  it("starts at 1 when nothing was imported in the current period", () => {
    const [s] = numberingSuggestions([inv("1/10/2025", "2025-10-02")], {}, now);
    expect(s).toMatchObject({ pattern: "{N}/{MM}/{YYYY}", nextNumber: "1/11/2025" });
  });

  it("stays quiet when our own numbering already continues the row", () => {
    expect(numberingSuggestions([inv("2025-0041", "2025-01-02"), inv("ZF2025-0003", "2025-01-02", "proforma")], {}, now)).toEqual([]);
    expect(numberingSuggestions([inv("FV2025017", "2025-03-01")], { invoice: "FV{YYYY}{NNN}" }, now)).toEqual([]);
  });

  it("never gives two document types the same pattern", () => {
    const out = numberingSuggestions([inv("2025001", "2025-02-01"), inv("2025002", "2025-02-01", "credit_note")], {}, now);
    expect(out.map((s) => s.documentType)).toEqual(["invoice"]);
  });
});
