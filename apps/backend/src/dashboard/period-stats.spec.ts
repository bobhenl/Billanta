import { describe, expect, it } from "vitest";
import { earliestDay, filterOptions, localDay, periodBreakdown, periodTotals, rateTo, type StatsDoc, type StatsExpense } from "./period-stats";
import { matchesFilters, parseReportFilters } from "./report-filters";

const d = (s: string) => new Date(`${s}T00:00:00`);
const FROM = d("2026-01-01");
const TO = d("2026-04-01"); // exclusive: Q1
const TODAY = d("2026-03-20");

let seq = 0;
function doc(over: Partial<StatsDoc>): StatsDoc {
  seq++;
  return {
    documentType: "invoice",
    status: "issued",
    currency: "CZK",
    language: "cs",
    date: d("2026-02-10"),
    issueDate: d("2026-02-10"),
    dueDate: d("2026-04-30"),
    paidAt: null,
    contactId: `c${seq}`,
    contactName: `Customer ${seq}`,
    exchangeRate: null,
    amountPaid: 0,
    base: 1000,
    vat: 210,
    total: 1210,
    ...over,
  };
}

describe("rateTo", () => {
  it("is 1 for the report currency, the stored rate for a foreign one, null without a rate", () => {
    expect(rateTo("CZK", null, "CZK")).toBe(1);
    expect(rateTo("EUR", 25, "CZK")).toBe(25);
    expect(rateTo("EUR", null, "CZK")).toBeNull();
    expect(rateTo("EUR", 0, "CZK")).toBeNull();
    // A report in EUR never converts CZK back.
    expect(rateTo("CZK", null, "EUR")).toBeNull();
    expect(rateTo("EUR", 25, "EUR")).toBe(1);
  });
});

describe("periodTotals", () => {
  it("counts foreign invoices at their stored rate and leaves out those without one", () => {
    const docs = [
      doc({ base: 1000, vat: 210, total: 1210 }),
      doc({ currency: "EUR", exchangeRate: 25, base: 100, vat: 21, total: 121 }),
      doc({ currency: "USD", exchangeRate: null, base: 7777, vat: 0, total: 7777 }),
    ];
    const t = periodTotals(docs, [], FROM, TO, "CZK", TODAY);
    expect(t.revenue).toBe(3500);
    expect(t.vat).toBe(735);
    expect(t.invoiceCount).toBe(2);
    expect(t.averageInvoice).toBe(1750);
  });

  it("converts expenses with their stored rate", () => {
    const expenses: StatsExpense[] = [
      { currency: "CZK", date: d("2026-02-01"), base: 300, exchangeRate: null },
      { currency: "EUR", date: d("2026-02-01"), base: 10, exchangeRate: 24 },
      { currency: "EUR", date: d("2026-02-01"), base: 999, exchangeRate: null },
    ];
    const t = periodTotals([doc({ base: 2000 })], expenses, FROM, TO, "CZK", TODAY);
    expect(t.expenses).toBe(540);
    expect(t.profit).toBe(1460);
  });

  it("splits unpaid outstanding from the overdue part, minus partial payments", () => {
    const docs = [
      doc({ total: 1000, dueDate: d("2026-03-01"), amountPaid: 400 }), // overdue, 600 open
      doc({ total: 500, dueDate: d("2026-04-15") }), // unpaid, not due yet
      doc({ documentType: "proforma", total: 200, dueDate: d("2026-03-10"), currency: "EUR", exchangeRate: 25 }), // overdue 5000
      doc({ status: "paid", total: 9000, paidAt: d("2026-02-20"), dueDate: d("2026-02-01") }),
      doc({ total: 333, date: d("2025-12-15"), dueDate: d("2026-01-01") }), // outside the period
    ];
    const t = periodTotals(docs, [], FROM, TO, "CZK", TODAY);
    expect(t.outstanding).toBe(6100);
    expect(t.outstandingCount).toBe(3);
    expect(t.overdue).toBe(5600);
    expect(t.overdueCount).toBe(2);
  });

  it("counts customers in the period and the ones invoiced for the first time", () => {
    const docs = [
      doc({ contactId: "old", date: d("2025-06-01") }),
      doc({ contactId: "old", date: d("2026-02-01") }),
      doc({ contactId: "new", date: d("2026-02-02") }),
      doc({ contactId: "new", date: d("2026-03-02") }),
      doc({ contactId: "proforma-only", documentType: "proforma" }),
    ];
    const t = periodTotals(docs, [], FROM, TO, "CZK", TODAY);
    expect(t.customerCount).toBe(2);
    expect(t.newCustomers).toBe(1);
  });

  it("averages days to payment over invoices paid in the period", () => {
    const docs = [
      doc({ status: "paid", issueDate: d("2026-02-01"), paidAt: d("2026-02-11") }),
      doc({ status: "paid", issueDate: d("2026-02-01"), paidAt: d("2026-02-21"), currency: "EUR", exchangeRate: 25, total: 10 }),
    ];
    const t = periodTotals(docs, [], FROM, TO, "CZK", TODAY);
    expect(t.averageDaysToPay).toBe(15);
    expect(t.collected).toBe(1460);
  });
});

describe("periodBreakdown", () => {
  it("reports converted and rate-less foreign documents separately", () => {
    const docs = [doc({}), doc({ currency: "EUR", exchangeRate: 25 }), doc({ currency: "EUR", exchangeRate: 25 }), doc({ currency: "USD" })];
    const b = periodBreakdown(docs, [], FROM, TO, "CZK", TODAY);
    expect(b.convertedCount).toBe(2);
    expect(b.missingRateCount).toBe(1);
    expect(b.byCurrency).toEqual([
      { currency: "EUR", count: 2, amount: 2000, converted: 50000 },
      { currency: "CZK", count: 1, amount: 1000, converted: 1000 },
      { currency: "USD", count: 1, amount: 1000, converted: null },
    ]);
  });

  it("folds customers beyond the top five into others", () => {
    const docs = [1, 2, 3, 4, 5, 6, 7].map((n) => doc({ contactId: `k${n}`, contactName: `K${n}`, base: n * 100 }));
    const b = periodBreakdown(docs, [], FROM, TO, "CZK", TODAY);
    expect(b.byCustomer.map((s) => s.key)).toEqual(["k7", "k6", "k5", "k4", "k3", "others"]);
    expect(b.byCustomer.at(-1)!.value).toBe(300);
    expect(b.topCustomers[0]).toMatchObject({ contactId: "k7", total: 700, count: 1 });
  });

  it("puts revenue into buckets in CZK and splits paid, unpaid and overdue", () => {
    const docs = [
      doc({ date: d("2026-01-05"), base: 100, total: 121, status: "paid", paidAt: d("2026-01-10") }),
      doc({ date: d("2026-02-05"), base: 10, total: 12, currency: "EUR", exchangeRate: 25, dueDate: d("2026-03-01") }),
      doc({ date: d("2026-03-05"), base: 50, total: 60, amountPaid: 20 }),
      doc({ documentType: "credit_note", date: d("2026-03-06"), base: -40, total: -48, vat: -8 }),
    ];
    // Five months, so the series goes by month.
    const b = periodBreakdown(docs, [{ currency: "CZK", date: d("2026-02-02"), base: 70, exchangeRate: null }], FROM, d("2026-06-01"), "CZK", TODAY);
    expect(b.grain).toBe("month");
    expect(b.series.slice(0, 3)).toEqual([
      { start: "2026-01-01", revenue: 100, expenses: 0 },
      { start: "2026-02-01", revenue: 250, expenses: 70 },
      { start: "2026-03-01", revenue: 10, expenses: 0 },
    ]);
    expect(b.payment).toEqual({ paid: 141, unpaid: 40, overdue: 300 });
    expect(b.byType).toEqual([
      { documentType: "invoice", count: 3, total: 481 },
      { documentType: "credit_note", count: 1, total: 48 },
    ]);
  });
});

describe("report filters", () => {
  const base = doc({ currency: "EUR", language: "en", contactId: "x", status: "issued", dueDate: d("2026-03-01") });

  it("match on each field", () => {
    expect(matchesFilters(base, {}, TODAY)).toBe(true);
    expect(matchesFilters(base, { currency: "EUR" }, TODAY)).toBe(true);
    expect(matchesFilters(base, { currency: "CZK" }, TODAY)).toBe(false);
    expect(matchesFilters(base, { language: "cs" }, TODAY)).toBe(false);
    expect(matchesFilters(base, { contactId: "y" }, TODAY)).toBe(false);
    expect(matchesFilters(base, { documentType: "proforma" }, TODAY)).toBe(false);
    expect(matchesFilters(base, { status: "paid" }, TODAY)).toBe(false);
    expect(matchesFilters(base, { status: "unpaid" }, TODAY)).toBe(true);
    expect(matchesFilters({ ...base, status: "paid" }, { status: "unpaid" }, TODAY)).toBe(false);
    expect(matchesFilters({ ...base, status: "paid" }, { status: "paid" }, TODAY)).toBe(true);
    expect(matchesFilters(base, { status: "overdue" }, TODAY)).toBe(true);
    expect(matchesFilters({ ...base, dueDate: d("2026-03-25") }, { status: "overdue" }, TODAY)).toBe(false);
    expect(matchesFilters({ ...base, status: "cancelled" }, { status: "cancelled" }, TODAY)).toBe(true);
  });

  it("parse and normalise valid input, treat empty strings as no filter", () => {
    expect(
      parseReportFilters({ currency: "eur", language: "EN", contactId: "6f1c2b8e-1f0a-4c3e-9a51-0d2b7c4e5f60", documentType: "invoice", status: "", from: "x" }),
    ).toEqual({ currency: "EUR", language: "en", contactId: "6f1c2b8e-1f0a-4c3e-9a51-0d2b7c4e5f60", documentType: "invoice" });
  });

  it.each([
    { currency: "EURO" },
    { currency: "E1R" },
    { language: "ces" },
    { contactId: "1 OR 1=1" },
    { documentType: "quote" },
    { status: "draft" },
    { status: ["paid", "unpaid"] },
  ])("reject %o", (query) => {
    expect(() => parseReportFilters(query)).toThrow();
  });

  it("filter options list currencies, languages and customers from all documents", () => {
    const o = filterOptions([doc({ contactId: "b", contactName: "Beta" }), doc({ contactId: "a", contactName: "Alfa", currency: "EUR", language: "en" })]);
    expect(o).toEqual({ currencies: ["CZK", "EUR"], languages: ["cs", "en"], customers: [{ id: "a", name: "Alfa" }, { id: "b", name: "Beta" }] });
  });
});

describe("earliestDay", () => {
  it("takes the oldest date of documents and expenses, at midnight", () => {
    const first = earliestDay([new Date(2025, 4, 3, 15, 30), null, new Date(2024, 10, 9, 8), undefined, new Date(2026, 0, 1)]);
    expect(first && localDay(first)).toBe("2024-11-09");
    expect(first?.getHours()).toBe(0);
  });

  it("is null without data, ignoring invalid dates", () => {
    expect(earliestDay([])).toBeNull();
    expect(earliestDay([null, new Date(Number.NaN)])).toBeNull();
  });
});
