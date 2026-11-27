import { describe, expect, it, vi } from "vitest";
import { annualIncomeOf, buildSealedAccountingXml } from "@faktur/cz-compliance";
import { computeVatBreakdown } from "../invoices/invoice-total.util";
import { ExportsService } from "./exports.service";

// The inputs the browser builds the CSV and the VAT filings from when amounts are sealed.

const env = `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(24)}`;
const creditEnv = `enc:v1:BBBBBBBBBBBBBBBB:${"Q".repeat(24)}`;

/** A query builder whose every await hands out the next queued result, in query order. */
function db(...results: unknown[]) {
  const queue = [...results];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "leftJoin", "where", "orderBy", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    if (!queue.length) return reject(new Error("unexpected query"));
    resolve(queue.shift());
  };
  return chain;
}

const invoice = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  encAmounts: null,
  invoiceNumber: id,
  documentType: "invoice",
  status: "issued",
  issueDate: new Date(2026, 8, 10),
  taxableSupplyDate: null,
  dueDate: new Date(2026, 8, 24),
  paidAt: null,
  currency: "CZK",
  exchangeRate: null,
  exchangeRateMode: null,
  variableSymbol: id,
  language: "cs",
  reverseCharge: false,
  reverseChargeCode: null,
  amountPaid: "0",
  customFields: [],
  internalNote: null,
  relatedInvoiceId: null,
  buyerSnapshot: null,
  contactId: "c1",
  ...over,
});
const contact = { id: "c1", legalName: "Alfa s.r.o.", ico: "12345678", dic: "CZ12345678", addressCountry: "CZ" };
const item = (invoiceId: string, price: string, over: Record<string, unknown> = {}) => ({
  invoiceId,
  quantity: "1",
  unitPrice: price,
  vatRate: "21",
  discountPercent: "0",
  encAmounts: null,
  ...over,
});
const placeholder = (invoiceId: string) => item(invoiceId, "0", { vatRate: null, encAmounts: env });
const period = { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) };
const tenant = { legalName: "Jan Novák", dic: "CZ8001011234", vatStatus: "payer", addressStreet: null, addressCity: null, addressPostalCode: null, addressCountry: "CZ", email: null, phone: null };

describe("ExportsService.invoicesCsvInputs", () => {
  it("keeps a sealed document in its place with the envelope and no totals", async () => {
    const rows = [
      { invoice: invoice("A"), contact },
      { invoice: invoice("S", { encAmounts: env }), contact },
    ];
    const out = await new ExportsService().invoicesCsvInputs(
      db(rows, [item("A", "1000"), placeholder("S")], [{ templateVars: [{ key: "x", value: "3", label: "X" }], country: "CZ" }]) as never,
      period,
    );
    expect(out.home).toBe("CZK");
    expect(out.companyVars).toEqual([{ key: "x", value: "3" }]);
    expect(out.rows.map((r) => [r.invoice.invoiceNumber, r.encAmounts, r.totals?.totalWithVat ?? null])).toEqual([
      ["A", null, 1210],
      ["S", env, null],
    ]);
    expect(out.rows[0]!.contact).toEqual({ legalName: "Alfa s.r.o.", ico: "12345678", dic: "CZ12345678" });
  });

  it("still refuses the CSV file itself", async () => {
    const rows = [{ invoice: invoice("S", { encAmounts: env }), contact }];
    await expect(new ExportsService().invoicesCsv(db(rows) as never, period)).rejects.toMatchObject({ status: 409 });
  });
});

describe("ExportsService.vatInputs", () => {
  it("sends a sealed document without parts but with its envelope and the rate of its tax point", async () => {
    const rows = [
      { invoice: invoice("A"), contact },
      { invoice: invoice("S", { encAmounts: env, currency: "EUR", exchangeRate: "25.1" }), contact },
    ];
    const out = await new ExportsService().vatInputs(
      db(rows, [item("A", "1000"), placeholder("S")], []) as never,
      { country: "CZ", kind: "kh1" },
      period,
      { year: 2026, month: 9 },
      tenant as never,
    );
    expect(out).toMatchObject({ country: "CZ", kind: "kh1", identified: false, period: { year: 2026, month: 9 } });
    expect(out.submitter).toMatchObject({ dic: "CZ8001011234" });
    const [plain, sealed] = out.issued;
    expect(plain).toMatchObject({ number: "A", parts: [{ ratePercent: 21, base: 1000, vat: 210 }], totalCzk: 1210 });
    expect(plain!.encAmounts).toBeUndefined();
    expect(sealed).toMatchObject({ number: "S", parts: [], totalCzk: 0, encAmounts: env, rate: 25.1 });
    expect(sealed!.taxableDate).toBe(new Date(2026, 8, 10).toISOString());
  });

  it("gives a Slovak company the Slovak submitter", async () => {
    const rows = [{ invoice: invoice("S", { encAmounts: env, currency: "EUR" }), contact }];
    const out = await new ExportsService().vatInputs(
      db(rows, [placeholder("S")], []) as never,
      { country: "SK", kind: "kv" },
      period,
      { year: 2026, month: 9 },
      { ...tenant, dic: "SK2020123456" } as never,
    );
    expect(out.submitter).toMatchObject({ icDph: "SK2020123456" });
    expect(out.issued[0]).toMatchObject({ encAmounts: env, rate: 1 });
  });

  it("still refuses the XML itself", async () => {
    const rows = [{ invoice: invoice("S", { encAmounts: env }), contact }];
    await expect(new ExportsService().vatReturn(db(rows) as never, "dp3", period, { year: 2026, month: 9 }, tenant as never)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("ExportsService.accountingInputs", () => {
  const accountingTenant = { ...tenant, ico: "87654321", country: "CZ" };
  const doc = (id: string, over: Record<string, unknown> = {}) =>
    invoice(id, { constantSymbol: null, specificSymbol: null, paymentMethod: "bank_transfer", noteBelow: null, ...over });
  const line = (invoiceId: string, price: string, over: Record<string, unknown> = {}) => item(invoiceId, price, { description: "Práce", unit: "h", ...over });

  it("keeps a sealed document in its place with its envelopes and no totals", async () => {
    const rows = [
      { invoice: doc("A"), contact },
      { invoice: doc("S", { encAmounts: env }), contact },
    ];
    const items = [line("A", "1000"), line("S", "0", { vatRate: null, encAmounts: "enc:v1:item" })];
    const out = await new ExportsService().accountingInputs(db(rows, items, []) as never, "pohoda", period, accountingTenant as never);
    expect(out).toMatchObject({ format: "pohoda", ico: "87654321", home: "CZK", period: { from: period.from.toISOString() } });
    const [plain, sealed] = out.invoices;
    expect(plain).toMatchObject({ encAmounts: null, totals: { totalWithVat: 1210 } });
    expect(plain!.lineItems[0]!.encAmounts).toBeNull();
    expect(sealed).toMatchObject({ encAmounts: env, totals: null });
    expect(sealed!.lineItems[0]).toMatchObject({ encAmounts: "enc:v1:item", unitPrice: "0" });
  });

  it("gives the browser what makes the same file as the server's once the envelopes are open", async () => {
    const rows = [{ invoice: doc("A"), contact }];
    const service = new ExportsService();
    const server = await service.pohodaXml(db(rows, [line("A", "1000")], []) as never, period, accountingTenant as never);
    const inputs = await service.accountingInputs(db(rows, [line("A", "1000")], []) as never, "pohoda", period, accountingTenant as never);
    expect(buildSealedAccountingXml(inputs, new Map(), new Map()).body).toBe(server);
  });

  it("still refuses the Pohoda and Money S3 files themselves", async () => {
    const rows = [{ invoice: doc("S", { encAmounts: env }), contact }];
    await expect(new ExportsService().pohodaXml(db(rows) as never, period, accountingTenant as never)).rejects.toMatchObject({ status: 409 });
    await expect(new ExportsService().moneyS3Xml(db(rows) as never, period, accountingTenant as never)).rejects.toMatchObject({ status: 409 });
  });
});

describe("ExportsService.annualSummary with sealed amounts", () => {
  const paid = (id: string, over: Record<string, unknown> = {}) => invoice(id, { status: "paid", paidAt: new Date(2026, 3, 1), createdAt: new Date(2026, 2, 1), ...over });
  const opts = { vatPayer: true, flatRate: null };

  it("sums the plain documents and hands out each sealed one with its envelope and rate", async () => {
    const found = [paid("A"), paid("S", { encAmounts: env, currency: "EUR", exchangeRate: "25" }), paid("D", { encAmounts: creditEnv, documentType: "credit_note" })];
    const out = await new ExportsService().annualSummary(db(found, [item("A", "1000")], []) as never, 2026, opts);
    expect(out.plainIncome).toBe(1000);
    expect(out.income).toBe(1000);
    expect(out.sealed).toEqual({ count: 2, ids: ["S", "D"] });
    expect(out.sealedDocs).toEqual([
      { encAmounts: env, documentType: "invoice", rate: 25 },
      { encAmounts: creditEnv, documentType: "credit_note", rate: 1 },
    ]);
  });

  it("subtracts a plain credit note, as the browser does a sealed one", async () => {
    const found = [paid("A"), paid("C", { documentType: "credit_note" })];
    const out = await new ExportsService().annualSummary(db(found, [item("A", "1000"), item("C", "300")], []) as never, 2026, opts);
    expect(out.plainIncome).toBe(700);
  });

  it("adds up, opened in the browser, to what the server sums for the same document in plain", async () => {
    const foreign = { currency: "EUR", exchangeRate: "25" };
    const plainYear = await new ExportsService().annualSummary(db([paid("A"), paid("S", foreign)], [item("A", "1000"), item("S", "400")], []) as never, 2026, opts);
    const sealedYear = await new ExportsService().annualSummary(db([paid("A"), paid("S", { ...foreign, encAmounts: env })], [item("A", "1000")], []) as never, 2026, opts);
    const opened = computeVatBreakdown([item("S", "400")] as never, { reverseCharge: false });
    const doc = sealedYear.sealedDocs[0]!;
    expect(sealedYear.plainIncome + annualIncomeOf(opened, doc.documentType, doc.rate!, true)).toBe(plainYear.income);
  });
});
