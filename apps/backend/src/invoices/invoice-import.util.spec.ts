import { describe, expect, it } from "vitest";
import { parseCsv } from "../contacts/contacts-csv.util";
import { mapInvoiceRows, ownNumberSequence, parseAmount, parseDate } from "./invoice-import.util";

const map = (csv: string) => mapInvoiceRows(parseCsv(csv));

describe("parseAmount", () => {
  it("reads Czech, English and currency-suffixed amounts", () => {
    expect(parseAmount("1 234,50")).toBe(1234.5);
    expect(parseAmount("1.234,50 Kč")).toBe(1234.5);
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("€ 99.9")).toBe(99.9);
    expect(parseAmount("-500")).toBe(-500);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("parseDate", () => {
  it("accepts ISO and Czech dates, rejects impossible ones", () => {
    expect(parseDate("2025-03-07")?.toISOString()).toBe("2025-03-07T00:00:00.000Z");
    expect(parseDate("7.3.2025")?.toISOString()).toBe("2025-03-07T00:00:00.000Z");
    expect(parseDate("07/03/2025 10:00")?.toISOString()).toBe("2025-03-07T00:00:00.000Z");
    expect(parseDate("31.2.2025")).toBeNull();
    expect(parseDate("1.1.1890")).toBeNull();
    expect(parseDate("tomorrow")).toBeNull();
  });
});

describe("mapInvoiceRows", () => {
  it("maps a Fakturoid-like totals export and derives the VAT rate", () => {
    const { invoices, skipped } = map(
      "Číslo;Odběratel;IČO;Vystaveno;Splatnost;Celkem bez DPH;Celkem;Měna;Stav;Zaplaceno dne\n" +
        "2025-0001;Alfa s.r.o.;1234567;2.1.2025;16.1.2025;1 000,00;1 210,00;CZK;Zaplaceno;10.1.2025\n" +
        "2025-0002;Beta a.s.;;5.1.2025;19.1.2025;500;500;CZK;Vystaveno;\n",
    );
    expect(skipped).toEqual([]);
    expect(invoices).toHaveLength(2);
    const [a, b] = invoices;
    expect(a).toMatchObject({ invoiceNumber: "2025-0001", status: "paid", currency: "CZK", documentType: "invoice" });
    expect(a!.customer.ico).toBe("01234567");
    expect(a!.paidAt?.toISOString()).toBe("2025-01-10T00:00:00.000Z");
    expect(a!.lines).toEqual([{ description: "Faktura 2025-0001", quantity: 1, unit: null, unitPrice: 1000, vatRate: 21 }]);
    expect(b).toMatchObject({ status: "issued", paidAt: null });
    expect(b!.lines[0]!.vatRate).toBe(0);
  });

  it("groups line-item rows by invoice number (iDoklad-like)", () => {
    const { invoices } = map(
      "Invoice number,Client,Issue date,Description,Qty,Unit price,VAT rate,Currency\n" +
        "FV-17,Gamma GmbH,2025-02-01,Consulting,10,80,0,EUR\n" +
        "FV-17,,,Travel,1,120.5,0,EUR\n",
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.currency).toBe("EUR");
    expect(invoices[0]!.lines.map((l) => [l.description, l.quantity, l.unitPrice])).toEqual([
      ["Consulting", 10, 80],
      ["Travel", 1, 120.5],
    ]);
  });

  it("reports unusable rows instead of failing the whole file", () => {
    const { invoices, skipped } = map(
      "Číslo;Odběratel;Datum vystavení;Celkem\n" +
        ";Alfa;1.1.2025;100\n" +
        "A2;;1.1.2025;100\n" +
        "A3;Alfa;nikdy;100\n" +
        "A4;Alfa;1.1.2025;?\n" +
        "A5;Alfa;1.1.2025;100\n" +
        "A5;Alfa;1.1.2025;100\n",
    );
    expect(invoices.map((i) => i.invoiceNumber)).toEqual(["A5"]);
    expect(skipped.map((s) => s.reason)).toEqual(["missing_number", "missing_customer", "invalid_date", "invalid_amount", "duplicate_in_file"]);
  });

  it("recognises proformas, credit notes and cancelled invoices", () => {
    const { invoices } = map(
      "Číslo;Odběratel;Vystaveno;Celkem;Typ;Stav\n" +
        "ZF2025-0001;Alfa;1.1.2025;100;;\n" +
        "X1;Alfa;1.1.2025;-100;;\n" +
        "X2;Alfa;1.1.2025;100;Opravný daňový doklad;\n" +
        "X3;Alfa;1.1.2025;100;;Stornováno\n",
    );
    expect(invoices.map((i) => i.documentType)).toEqual(["proforma", "credit_note", "credit_note", "invoice"]);
    expect(invoices[3]!.status).toBe("cancelled");
  });

  it("rejects files that are not invoice lists", () => {
    expect(() => map("Název;IČO;E-mail\nAlfa;1;a@b.cz\n")).toThrow("unknown_columns");
  });
});

describe("ownNumberSequence", () => {
  it("parses only our own number format", () => {
    expect(ownNumberSequence("2026-0042")).toEqual({ series: "", year: 2026, sequence: 42 });
    expect(ownNumberSequence("ZF2026-0003")).toEqual({ series: "ZF", year: 2026, sequence: 3 });
    expect(ownNumberSequence("FV-17")).toBeNull();
  });
});
