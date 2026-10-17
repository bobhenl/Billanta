import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { computeVatBreakdown } from "../invoices/invoice-total.util";
import { parseInvoiceExportQuery } from "./exports.controller";
import { type CsvInvoiceRow, invoicesCsvBody } from "./exports.service";

const d = (s: string) => new Date(`${s}T00:00:00`);

function row(invoice: Record<string, unknown>, items: { qty: number; price: number; vat: number }[], contact: Record<string, unknown> | null = null): CsvInvoiceRow {
  const lineItems = items.map((i, n) => ({ quantity: String(i.qty), unitPrice: String(i.price), vatRate: String(i.vat), sortOrder: n }));
  return {
    invoice: {
      invoiceNumber: "2026001",
      documentType: "invoice",
      status: "issued",
      currency: "CZK",
      language: "cs",
      exchangeRate: null,
      issueDate: d("2026-03-02"),
      taxableSupplyDate: null,
      dueDate: d("2026-03-16"),
      paidAt: null,
      variableSymbol: "2026001",
      reverseCharge: false,
      amountPaid: "0",
      customFields: [],
      internalNote: null,
      ...invoice,
    } as unknown as CsvInvoiceRow["invoice"],
    contact: contact as CsvInvoiceRow["contact"],
    totals: computeVatBreakdown(lineItems as never),
  };
}

const parse = (body: string) =>
  body
    .replace(/^﻿/, "")
    .trimEnd()
    .split("\r\n")
    .map((l) => l.split(";"));

describe("accountant invoice CSV", () => {
  const body = invoicesCsvBody([
    row({}, [
      { qty: 1, price: 1000, vat: 21 },
      { qty: 2, price: 50, vat: 12 },
    ], { legalName: "Alfa s.r.o.", ico: "12345678", dic: "CZ12345678" }),
    row(
      { invoiceNumber: "2026002", currency: "EUR", exchangeRate: "24.835", taxableSupplyDate: d("2026-02-28"), status: "paid", paidAt: d("2026-03-10") },
      [{ qty: 1, price: 100, vat: 0 }],
    ),
    row({ invoiceNumber: "2026003", currency: "USD", exchangeRate: null }, [{ qty: 1, price: 10, vat: 21 }]),
  ]);
  const [header, czk, eur, usd] = parse(body);
  const col = (r: string[], name: string) => r[header!.indexOf(name)];

  it("is BOM-prefixed, semicolon-separated, CRLF", () => {
    expect(body.startsWith("﻿Číslo;Typ;Vystaveno;DUZP;Splatnost;Uhrazeno;Odběratel;IČO;DIČ;Měna;")).toBe(true);
    expect(body.endsWith("\r\n")).toBe(true);
  });

  it("has a base and VAT column per rate present, highest first, and the CZK columns", () => {
    expect(header!.slice(10, 15)).toEqual(["Základ 21 %", "DPH 21 %", "Základ 12 %", "DPH 12 %", "Základ 0 %"]);
    expect(header!.slice(15, 22)).toEqual(["Základ celkem", "DPH celkem", "Celkem", "Kurz ČNB", "Celkem v CZK", "VS", "Stav"]);
  });

  it("fills the rate columns per document", () => {
    expect([col(czk!, "Základ 21 %"), col(czk!, "DPH 21 %"), col(czk!, "Základ 12 %"), col(czk!, "DPH 12 %"), col(czk!, "Základ 0 %")]).toEqual([
      "1000,00",
      "210,00",
      "100,00",
      "12,00",
      "",
    ]);
    expect(col(czk!, "Celkem")).toBe("1322,00");
    expect(col(czk!, "IČO")).toBe("12345678");
    expect(col(czk!, "DIČ")).toBe("CZ12345678");
  });

  it("converts with the stored rate and keeps its decimals", () => {
    expect(col(czk!, "Kurz ČNB")).toBe("1");
    expect(col(czk!, "Celkem v CZK")).toBe("1322,00");
    expect(col(eur!, "Kurz ČNB")).toBe("24,835");
    expect(col(eur!, "Celkem v CZK")).toBe("2483,50");
    expect(col(eur!, "DUZP")).toBe("28.2.2026");
    expect(col(eur!, "Uhrazeno")).toBe("10.3.2026");
    expect(col(eur!, "Stav")).toBe("Uhrazeno");
  });

  it("leaves the CZK total empty when a foreign document has no rate", () => {
    expect(col(usd!, "Kurz ČNB")).toBe("");
    expect(col(usd!, "Celkem v CZK")).toBe("");
    expect(col(usd!, "Celkem")).toBe("12,10");
  });
});

describe("CSV cells", () => {
  it("defuse text that Excel would run as a formula", () => {
    const [, r] = parse(invoicesCsvBody([row({}, [{ qty: 1, price: 1, vat: 21 }], { legalName: "=HYPERLINK(1)", ico: "+420", dic: null })]));
    expect(r![6]).toBe("'=HYPERLINK(1)");
    expect(r![7]).toBe("'+420");
  });
});

describe("invoice export query", () => {
  it("accepts filters and the date basis", () => {
    expect(parseInvoiceExportQuery({ month: "2026-03", currency: "eur", status: "overdue", dateBy: "supply" })).toEqual({
      filters: { currency: "EUR", status: "overdue" },
      dateBy: "supply",
    });
    expect(parseInvoiceExportQuery({}).dateBy).toBe("issue");
  });

  it.each([{ dateBy: "due" }, { contactId: "not-a-uuid" }, { status: "draft" }, { language: "czech" }])("rejects %o with 400", (q) => {
    expect(() => parseInvoiceExportQuery(q)).toThrow(BadRequestException);
  });
});
