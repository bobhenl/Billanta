import { describe, expect, it } from "vitest";
import { invoiceFormPrefsSchema, PDF_ACCENTS, pdfAccentOf, tintOf } from "./invoice-form-prefs";

describe("invoice form prefs", () => {
  it("defaults to net prices and the first accent", () => {
    const prefs = invoiceFormPrefsSchema.parse({});
    expect(prefs.pricesIncludeVat).toBe(false);
    expect(prefs.pdfAccent).toBe(PDF_ACCENTS[0]);
  });

  it("rejects an accent outside the palette", () => {
    expect(invoiceFormPrefsSchema.safeParse({ pdf_accent: "#ff00ff" }).success).toBe(false);
  });

  it("falls back to the default accent for old or unknown stored values", () => {
    expect(pdfAccentOf(null)).toBe(PDF_ACCENTS[0]);
    expect(pdfAccentOf({ pdfAccent: "red" })).toBe(PDF_ACCENTS[0]);
    expect(pdfAccentOf({ pdfAccent: "#0d9488" })).toBe("#0d9488");
  });

  it("tints towards white", () => {
    expect(tintOf("#000000", 0.1)).toBe("#e6e6e6");
    expect(tintOf("#ffffff")).toBe("#ffffff");
  });
});
