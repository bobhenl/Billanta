import { describe, expect, it } from "vitest";
import { summarizeUsage, type InvoiceUsageRow, type UsageInput } from "./usage";

function inv(over: Partial<InvoiceUsageRow>): InvoiceUsageRow {
  return { documentType: "invoice", status: "paid", currency: "CZK", language: "cs", reverseCharge: false, recent: true, overdue: false, n: 1, ...over };
}

function input(over: Partial<UsageInput> = {}): UsageInput {
  return {
    invoices: [],
    expenses: [],
    connections: [],
    transactions: { total: 0, matched: 0, paypal: 0 },
    recurringCount: 0,
    templateCount: 0,
    contactCount: 0,
    tenant: { vatStatus: "non_payer", dicVatPayer: false, legalName: "Jan Novák" },
    ...over,
  };
}

describe("summarizeUsage", () => {
  it("an empty company uses nothing", () => {
    const u = summarizeUsage(input());
    expect(u.has).toEqual({
      invoices: false,
      expenses: false,
      foreignCurrencies: false,
      multipleLanguages: false,
      bank: false,
      paypal: false,
      proformas: false,
      quotes: false,
      creditNotes: false,
      recurring: false,
      templates: false,
      vat: false,
    });
    expect(u.currencies).toEqual([]);
    expect(u.foreignCurrencies).toEqual([]);
    expect(u.accountType).toBe("self_employed");
  });

  it("counts currencies across invoices and expenses, most used first, with the last-12-months split", () => {
    const u = summarizeUsage(
      input({
        invoices: [inv({ n: 5 }), inv({ currency: "EUR", n: 2 }), inv({ currency: "EUR", recent: false, n: 3 }), inv({ currency: "USD", n: 1 })],
        expenses: [
          { currency: "CZK", recent: true, n: 4 },
          { currency: "USD", recent: false, n: 7 },
        ],
      }),
    );
    expect(u.currencies).toEqual([
      { code: "CZK", invoices: 5, invoices12m: 5, expenses: 4, expenses12m: 4 },
      { code: "USD", invoices: 1, invoices12m: 1, expenses: 7, expenses12m: 0 },
      { code: "EUR", invoices: 5, invoices12m: 2, expenses: 0, expenses12m: 0 },
    ]);
    // The home currency is never a "foreign" one.
    expect(u.foreignCurrencies).toEqual(["USD", "EUR"]);
    expect(u.has.foreignCurrencies).toBe(true);
    expect(u.expenses).toEqual({ count: 11, count12m: 4 });
  });

  it("prefers currencies used lately, falling back to all-time ones", () => {
    const lately = summarizeUsage(input({ invoices: [inv({ currency: "EUR", n: 9, recent: false }), inv({ currency: "GBP", n: 1 })] }));
    expect(lately.foreignCurrencies).toEqual(["GBP"]);
    const old = summarizeUsage(input({ invoices: [inv({ currency: "EUR", n: 9, recent: false }), inv({ currency: "GBP", n: 1, recent: false })] }));
    expect(old.foreignCurrencies).toEqual(["EUR", "GBP"]);
  });

  it("ignores drafts for currencies, languages and document types", () => {
    const u = summarizeUsage(
      input({
        invoices: [inv({ status: "draft", currency: "EUR", language: "en", n: 3 }), inv({ status: "pending_review", documentType: "proforma", n: 2 }), inv({})],
      }),
    );
    expect(u.currencies.map((c) => c.code)).toEqual(["CZK"]);
    expect(u.languages).toEqual(["cs"]);
    expect(u.has.multipleLanguages).toBe(false);
    expect(u.documents).toEqual({ invoices: 1, proformas: 0, quotes: 0, creditNotes: 0, drafts: 5, reverseCharge: 0 });
  });

  it("tells document types and languages apart", () => {
    const u = summarizeUsage(
      input({
        invoices: [
          inv({ n: 4 }),
          inv({ documentType: "proforma", language: "en", n: 7 }),
          inv({ documentType: "quote", status: "issued" }),
          inv({ documentType: "credit_note" }),
        ],
      }),
    );
    expect(u.documents).toMatchObject({ invoices: 4, proformas: 7, quotes: 1, creditNotes: 1 });
    expect(u.languages).toEqual(["en", "cs"]);
    expect(u.has).toMatchObject({ invoices: true, proformas: true, quotes: true, creditNotes: true, multipleLanguages: true });
  });

  it("counts unpaid and overdue like the dashboard cards: no quotes, no credit notes", () => {
    const u = summarizeUsage(
      input({
        invoices: [
          inv({ status: "issued", n: 3 }),
          inv({ status: "issued", overdue: true, n: 2 }),
          inv({ status: "issued", documentType: "proforma", overdue: true }),
          inv({ status: "issued", documentType: "quote", n: 5 }),
          inv({ status: "issued", documentType: "credit_note", n: 7 }),
          inv({ status: "paid", n: 11 }),
        ],
      }),
    );
    expect(u.unpaidCount).toBe(6);
    expect(u.overdueCount).toBe(3);
  });

  it("detects bank API and PayPal connections and imported payments", () => {
    const fio = summarizeUsage(input({ connections: [{ provider: "fio", status: "active", enabled: true }] }));
    expect(fio.has.bank).toBe(true);
    expect(fio.has.paypal).toBe(false);
    expect(fio.bank).toMatchObject({ connections: 1, activeConnections: 1, bankApi: true, paypal: false });

    const paypal = summarizeUsage(input({ connections: [{ provider: "paypal", status: "active", enabled: false }] }));
    expect(paypal.has.paypal).toBe(true);
    expect(paypal.bank).toMatchObject({ bankApi: false, activeConnections: 0 });

    // A CSV import alone, no connection: still uses the bank pairing.
    const csv = summarizeUsage(input({ transactions: { total: 40, matched: 12, paypal: 0 } }));
    expect(csv.has.bank).toBe(true);
    expect(csv.bank).toMatchObject({ connections: 0, transactions: 40, matched: 12, bankApi: false });

    const paypalImport = summarizeUsage(input({ transactions: { total: 3, matched: 0, paypal: 3 } }));
    expect(paypalImport.has.paypal).toBe(true);
  });

  it("shows VAT for a payer, for an identified person only with reverse-charge documents, never for a non-payer", () => {
    const rc = [inv({ reverseCharge: true })];
    expect(summarizeUsage(input({ tenant: { vatStatus: "payer", dicVatPayer: true, legalName: null } })).has.vat).toBe(true);
    expect(summarizeUsage(input({ tenant: { vatStatus: "identified", dicVatPayer: false, legalName: null } })).has.vat).toBe(false);
    expect(summarizeUsage(input({ invoices: rc, tenant: { vatStatus: "identified", dicVatPayer: false, legalName: null } })).has.vat).toBe(true);
    expect(summarizeUsage(input({ invoices: rc, tenant: { vatStatus: "non_payer", dicVatPayer: false, legalName: null } })).has.vat).toBe(false);
    // A cancelled reverse-charge invoice is not VAT data.
    const cancelled = [inv({ reverseCharge: true, status: "cancelled" })];
    expect(summarizeUsage(input({ invoices: cancelled, tenant: { vatStatus: "identified", dicVatPayer: false, legalName: null } })).has.vat).toBe(false);
  });

  it("falls back to the legacy payer flag when vat_status is missing", () => {
    expect(summarizeUsage(input({ tenant: { vatStatus: null, dicVatPayer: true, legalName: null } })).vatStatus).toBe("payer");
    expect(summarizeUsage(input({ tenant: { vatStatus: null, dicVatPayer: false, legalName: null } })).vatStatus).toBe("non_payer");
  });

  it("tells a company from a sole trader by its legal form", () => {
    expect(summarizeUsage(input({ tenant: { vatStatus: "payer", dicVatPayer: true, legalName: "Acme s.r.o." } })).accountType).toBe("company");
    expect(summarizeUsage(input({ tenant: { vatStatus: "payer", dicVatPayer: true, legalName: "Jana Malá" } })).accountType).toBe("self_employed");
  });

  it("passes the simple counters through", () => {
    const u = summarizeUsage(input({ recurringCount: 2, templateCount: 0, contactCount: 17 }));
    expect(u.has.recurring).toBe(true);
    expect(u.has.templates).toBe(false);
    expect(u.contactCount).toBe(17);
  });
});
