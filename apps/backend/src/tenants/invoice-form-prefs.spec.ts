import { describe, expect, it } from "vitest";
import { invoiceFormPrefsSchema, MAX_DEFAULT_ITEMS, PDF_ACCENTS, pdfAccentOf, tintOf } from "./invoice-form-prefs";

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
  it("stores the blank-invoice defaults in the shape the form reads", () => {
    const prefs = invoiceFormPrefsSchema.parse({
      default_currency: "EUR",
      default_bank_account_id: "11111111-1111-4111-8111-111111111111",
      default_contact_id: "22222222-2222-4222-8222-222222222222",
      default_note_above: "  Fakturujeme Vám  ",
      default_items: [
        { description: " Hosting ", quantity: 2, unit: "měs", unit_price: 450, vat_rate: 21 },
        { description: "Doprava" },
      ],
    });
    expect(prefs.defaultCurrency).toBe("EUR");
    expect(prefs.defaultBankAccountId).toBe("11111111-1111-4111-8111-111111111111");
    expect(prefs.defaultContactId).toBe("22222222-2222-4222-8222-222222222222");
    expect(prefs.defaultNoteAbove).toBe("Fakturujeme Vám");
    expect(prefs.defaultItems).toEqual([
      { description: "Hosting", quantity: 2, unit: "měs", unitPrice: 450, vatRate: 21 },
      { description: "Doprava", quantity: 1, unit: null, unitPrice: 0, vatRate: null },
    ]);
  });

  it("leaves the blank-invoice defaults empty when not set", () => {
    const prefs = invoiceFormPrefsSchema.parse({ default_currency: null, default_note_above: "" });
    expect(prefs.defaultCurrency).toBeNull();
    expect(prefs.defaultBankAccountId).toBeNull();
    expect(prefs.defaultContactId).toBeNull();
    expect(prefs.defaultNoteAbove).toBeNull();
    expect(prefs.defaultItems).toEqual([]);
  });

  it("rejects malformed blank-invoice defaults", () => {
    const bad = [
      { default_currency: "eur" },
      { default_contact_id: "not-a-uuid" },
      { default_bank_account_id: "acc-1" },
      { default_items: [{ description: "" }] },
      { default_items: [{ description: "X", vat_rate: 120 }] },
      { default_items: Array.from({ length: MAX_DEFAULT_ITEMS + 1 }, () => ({ description: "X" })) },
    ];
    for (const input of bad) expect(invoiceFormPrefsSchema.safeParse(input).success, JSON.stringify(input).slice(0, 60)).toBe(false);
    expect(invoiceFormPrefsSchema.safeParse({ default_items: Array.from({ length: MAX_DEFAULT_ITEMS }, () => ({ description: "X" })) }).success).toBe(true);
  });
});
