import { describe, expect, it } from "vitest";
import { vatActivity, type ActivityInvoice } from "./vat-activity";

const inv = (o: Partial<ActivityInvoice> & { country?: string; dic?: string | null; isPerson?: boolean } = {}): ActivityInvoice => ({
  documentType: "invoice",
  invoiceNumber: "2026001",
  status: "issued",
  date: new Date(2026, 8, 10),
  customer: { ico: null, dic: o.dic === undefined ? "DE123456789" : o.dic, isPerson: o.isPerson ?? false, country: o.country ?? "DE" },
  ...o,
});

describe("vatActivity", () => {
  it("counts issued invoices to EU businesses by month", () => {
    const r = vatActivity("CZ", [inv(), inv({ date: new Date(2026, 7, 31), documentType: "credit_note" })], []);
    expect(r.euSalesMonths).toEqual(["2026-08", "2026-09"]);
  });

  it("ignores CZ, UK and private buyers, drafts, cancelled documents and pro formas", () => {
    const r = vatActivity(
      "CZ",
      [
        inv({ country: "CZ", dic: "CZ12345679" }),
        inv({ country: "GB", dic: "GB123456789" }),
        inv({ isPerson: true }),
        inv({ invoiceNumber: null }),
        inv({ status: "cancelled" }),
        inv({ documentType: "proforma" }),
      ],
      [],
    );
    expect(r.euSalesMonths).toEqual([]);
  });

  it("treats CZ as abroad for a Slovak company", () => {
    expect(vatActivity("SK", [inv({ country: "CZ", dic: "CZ12345679" })], []).euSalesMonths).toEqual(["2026-09"]);
  });

  it("finds purchases from abroad by the supplier DIČ prefix or contact country", () => {
    const r = vatActivity("CZ", [], [
      { date: new Date(2026, 8, 3), supplierDic: "IE6388047V", supplierCountry: null },
      { date: new Date(2026, 7, 3), supplierDic: null, supplierCountry: "US" },
      { date: new Date(2026, 6, 3), supplierDic: "CZ12345679", supplierCountry: "CZ" },
      { date: new Date(2026, 5, 3), supplierDic: null, supplierCountry: null },
    ]);
    expect(r.foreignPurchaseMonths).toEqual(["2026-08", "2026-09"]);
  });
});
