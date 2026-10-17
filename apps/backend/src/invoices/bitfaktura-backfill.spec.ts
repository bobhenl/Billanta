import { describe, expect, it } from "vitest";
import { planBitfakturaBackfill, type BackfillRow } from "./bitfaktura-backfill";
import type { BitfakturaInvoice } from "./bitfaktura-import";

const at = new Date("2026-10-01T00:00:00Z");

const source = (over: Partial<BitfakturaInvoice> = {}): BitfakturaInvoice => ({
  id: 7,
  number: "5/2026",
  kind: "vat",
  status: "paid",
  issue_date: "2026-04-02",
  currency: "EUR",
  exchange_rate: "24.31",
  exchange_kind: "cnb",
  exchange_date: "2026-04-01",
  description: "Daň odvede zákazník v režimu přenesené daňové povinnosti.",
  internal_note: "Sleva domluvena telefonem",
  oid: "PO-3",
  place: "Zlín",
  seller_person: "Karel Dub",
  seller_name: "Dubová dílna",
  seller_tax_no: "CZ11223344",
  seller_street: "Polní 3",
  seller_city: "Zlín",
  seller_post_code: "760 01",
  buyer_name: "Nordic AB",
  buyer_tax_no: "SE556677889901",
  buyer_city: "Malmö",
  buyer_country: "SE",
  positions: [{ name: "Práce", quantity: "1", price_net: "400", tax: "0" }],
  ...over,
});

/** An invoice the first import version brought in: no notes, VS or rate origin, reverse charge off. */
const row = (over: Partial<BackfillRow> = {}): BackfillRow => ({
  id: "row-1",
  invoiceNumber: "5/2026",
  source: "import",
  variableSymbol: null,
  noteBelow: null,
  internalNote: null,
  orderNumber: null,
  issuePlace: null,
  issuedByName: null,
  reverseCharge: false,
  exchangeRate: "24.310000",
  exchangeRateMode: null,
  exchangeRateDate: null,
  sellerSnapshot: null,
  buyerSnapshot: null,
  ...over,
});

describe("planBitfakturaBackfill", () => {
  it("fills every empty field the source has", () => {
    const [plan] = planBitfakturaBackfill([source()], [row()], at);
    expect(plan!.id).toBe("row-1");
    expect(plan!.patch).toMatchObject({
      variableSymbol: "52026",
      noteBelow: "Daň odvede zákazník v režimu přenesené daňové povinnosti.",
      internalNote: "Sleva domluvena telefonem",
      orderNumber: "PO-3",
      issuePlace: "Zlín",
      issuedByName: "Karel Dub",
      reverseCharge: true,
      exchangeRateMode: "cnb_daily",
      exchangeRateDate: "2026-04-01",
      sellerSnapshot: { legalName: "Dubová dílna", addressStreet: "Polní 3", dic: "CZ11223344", source: "import" },
      buyerSnapshot: { legalName: "Nordic AB", dic: "SE556677889901", addressCity: "Malmö", source: "import" },
    });
  });

  it("never overwrites a filled field and never writes amounts, lines, numbers or dates", () => {
    const filled = row({
      variableSymbol: "999",
      noteBelow: "Upraveno ručně",
      internalNote: "x",
      orderNumber: "y",
      issuePlace: "Praha",
      issuedByName: "Jana",
      reverseCharge: true,
      exchangeRateMode: "manual",
      exchangeRateDate: "2026-01-01",
      sellerSnapshot: { legalName: "Ručně", addressStreet: null, dic: "CZ11223344", ico: null, addressCity: "Zlín", addressPostalCode: "760 01", addressCountry: "CZ", companyName: "Ručně", dicVatPayer: false, capturedAt: "2026-05-01T00:00:00.000Z", source: "manual_refresh" },
      buyerSnapshot: { legalName: "Nordic AB", ico: null, dic: "SE556677889901", email: null, addressStreet: null, addressCity: "Malmö", addressPostalCode: null, addressCountry: "SE" },
    });
    expect(planBitfakturaBackfill([source()], [filled], at)).toEqual([]);
    const [plan] = planBitfakturaBackfill([source()], [row()], at);
    for (const key of ["invoiceNumber", "issueDate", "dueDate", "currency", "exchangeRate", "amountPaid", "status", "lines"]) {
      expect(plan!.patch).not.toHaveProperty(key);
    }
  });

  it("adds only the keys a stored snapshot lacks, keeping a known-empty one", () => {
    const [plan] = planBitfakturaBackfill(
      [source()],
      [row({ sellerSnapshot: { legalName: "Ručně", addressStreet: null, capturedAt: "2026-05-01T00:00:00.000Z", source: "import" } })],
      at,
    );
    expect(plan!.patch.sellerSnapshot).toEqual({
      legalName: "Ručně",
      addressStreet: null,
      companyName: "Dubová dílna",
      dic: "CZ11223344",
      addressCity: "Zlín",
      addressPostalCode: "760 01",
      addressCountry: "CZ",
      capturedAt: "2026-05-01T00:00:00.000Z",
      source: "import",
    });
  });

  it("leaves reverse charge off where a line has VAT, and the rate origin where the rate differs", () => {
    const [plan] = planBitfakturaBackfill(
      [source({ positions: [{ name: "Práce", quantity: "1", price_net: "400", tax: "21" }] })],
      [row({ exchangeRate: "24.500000" })],
      at,
    );
    expect(plan!.patch).not.toHaveProperty("reverseCharge");
    expect(plan!.patch).not.toHaveProperty("exchangeRateMode");
    expect(plan!.patch).not.toHaveProperty("exchangeRateDate");
  });

  it("touches only imported rows with the same number", () => {
    expect(
      planBitfakturaBackfill(
        [source(), source({ id: 8, number: "6/2026" })],
        [row({ id: "manual", source: "manual" }), row({ id: "other", invoiceNumber: "7/2026" })],
        at,
      ),
    ).toEqual([]);
  });
});
