import { buildSealedNetIncome, type DocumentAmounts } from "@faktur/cz-compliance";
import { describe, expect, it, vi } from "vitest";

const homeRates = vi.hoisted(() => ({ getHomeRate: vi.fn(async () => null) }));
vi.mock("../exports/home-rates", () => homeRates);

import * as schema from "../../drizzle/schema";
import { NetIncomeService } from "./net-income.service";
import { DEFAULT_TAX_MODEL } from "./tax-model";

const ENV = `enc:v1:AAAAAAAAAAAAAAA1:${"Q".repeat(24)}`;

const invoice = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  invoiceNumber: id,
  documentType: "invoice",
  status: "paid",
  paidAt: new Date(2026, 1, 10),
  currency: "CZK",
  exchangeRate: null,
  receivedCzk: null,
  reverseCharge: false,
  partnerShares: null,
  createdByUserId: null,
  buyerSnapshot: null,
  encAmounts: null,
  ...over,
});

/** A tenant DB: the tenant row, the period's invoices and their items, whatever the query. */
function fakeDb(rows: ReturnType<typeof invoice>[], taxModel: unknown = null) {
  const itemQueries: unknown[] = [];
  const items = [{ invoiceId: "P1", quantity: "2", unitPrice: "5000", vatRate: "21", discountPercent: "0" }];
  const db = {
    select: () => {
      let table: unknown;
      const q = {
        from: (t: unknown) => ((table = t), q),
        leftJoin: () => q,
        where: (w: unknown) => (table === schema.invoiceLineItems && itemQueries.push(w), q),
        orderBy: () => q,
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
          Promise.resolve(
            table === schema.tenants
              ? [{ id: "t1", country: "CZ", dicVatPayer: true, taxModel, invoiceFormPrefs: null }]
              : table === schema.invoices
                ? rows.map((r) => ({ invoice: r, contact: { legalName: "Alfa s.r.o." } }))
                : items,
          ).then(ok, fail),
      };
      return q;
    },
  };
  return { db: db as never, itemQueries };
}

const Q1 = { year: 2026, month: null, quarter: 1 };
const sealedRow = (over: Record<string, unknown> = {}) => invoice("S1", { encAmounts: ENV, currency: "EUR", exchangeRate: "25", ...over });

describe("NetIncomeService.inputs (Confidential mode)", () => {
  it("hands out the sealed documents with their envelope and rate, never an amount", async () => {
    const { db } = fakeDb([invoice("P1"), sealedRow()]);
    const inputs = await new NetIncomeService().inputs(db, "t1", Q1);
    expect(inputs.period).toEqual({ ...Q1, months: 3, from: "2026-01-01", to: "2026-04-01" });
    expect(inputs.invoices).toEqual([expect.objectContaining({ id: "P1", amount: 10_000, income: 10_000, source: "czk" })]);
    expect(inputs.sealedDocs).toEqual([
      {
        id: "S1",
        number: "S1",
        customer: "Alfa s.r.o.",
        paidAt: "2026-02-10",
        month: 2,
        currency: "EUR",
        partnerShares: null,
        claimedShares: null,
        documentType: "invoice",
        encAmounts: ENV,
        rate: 25,
      },
    ]);
  });

  it("gives a sealed CZK document the rate 1 and a foreign one without a rate null", async () => {
    const { db } = fakeDb([sealedRow({ id: "S1", currency: "CZK", exchangeRate: null }), sealedRow({ id: "S2", exchangeRate: null })]);
    const inputs = await new NetIncomeService().inputs(db, "t1", Q1);
    expect(inputs.sealedDocs.map((d) => [d.id, d.rate])).toEqual([
      ["S1", 1],
      ["S2", null],
    ]);
    // A plain document without a rate is counted there; a sealed one only once opened.
    expect(inputs.missingRates).toBe(0);
  });

  it("doesn't load the items of a sealed document (they hold only the placeholder)", async () => {
    const { db, itemQueries } = fakeDb([sealedRow()]);
    await new NetIncomeService().inputs(db, "t1", Q1);
    expect(itemQueries).toEqual([]);
  });

  it("the report leaves the sealed ones out and says which; the browser adds them to the same figures", async () => {
    const rows = [invoice("P1"), sealedRow()];
    const service = new NetIncomeService();
    const report = await service.report(fakeDb(rows).db, "t1", Q1);
    expect(report.sealed).toEqual({ count: 1, ids: ["S1"] });
    expect(report.result.totals.income).toBe(10_000);

    const opened = new Map<string, DocumentAmounts>([[ENV, { totalWithoutVat: 400, totalVat: 84, totalWithVat: 484, byRate: [] }]]);
    const built = buildSealedNetIncome(await service.inputs(fakeDb(rows).db, "t1", Q1), opened).report!;
    // A VAT payer: 400 EUR without VAT at 25.
    expect(built.result.totals.income).toBe(20_000);
    const { sealed: _sealed, ...plainPart } = report;
    expect({ ...built, result: plainPart.result, tips: plainPart.tips, byMonth: plainPart.byMonth, invoices: plainPart.invoices }).toEqual(plainPart);
  });

  it("sends the whole year's income for a quarter only when the year has actual payments to prorate", async () => {
    const rows = [invoice("P1"), sealedRow()];
    const service = new NetIncomeService();
    expect((await service.inputs(fakeDb(rows).db, "t1", Q1)).yearIncome).toBeUndefined();
    const year = { ...DEFAULT_TAX_MODEL, tax_scope: "one_person", tax_credits: 0, partners: {}, actual_social: 20_000 };
    const inputs = await service.inputs(fakeDb(rows, { ...DEFAULT_TAX_MODEL, years: { 2026: year } }).db, "t1", Q1);
    expect(inputs.yearIncome).toEqual({ invoices: 10_000, sealedDocs: [{ documentType: "invoice", encAmounts: ENV, rate: 25 }] });
  });
});
