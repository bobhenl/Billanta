import { describe, expect, it } from "vitest";
import { parseCsv } from "../contacts/contacts-csv.util";
import {
  highestImportedSequences,
  importedNumberSequence,
  mapInvoiceRows,
  ownNumberSequence,
  parseAmount,
  parseDate,
  parseFlag,
  parseReverseChargeCode,
  paymentMethodOf,
} from "./invoice-import.util";

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

describe("parseFlag", () => {
  it("reads yes/no cells in Czech, Slovak and English", () => {
    for (const yes of ["Ano", "áno", "A", "yes", "Y", "TRUE", "1", "x", "Pravda"]) expect(parseFlag(yes)).toBe(true);
    for (const no of ["Ne", "nie", "N", "no", "false", "0", "Nepravda"]) expect(parseFlag(no)).toBe(false);
    expect(parseFlag("")).toBeNull();
    expect(parseFlag(undefined)).toBeNull();
    expect(parseFlag("Přenesená daňová povinnost")).toBeNull();
  });
});

describe("paymentMethodOf", () => {
  it("maps the usual labels and keeps any other as the printed label", () => {
    expect(paymentMethodOf("Převodem")).toEqual({ paymentMethod: "bank_transfer", paymentMethodLabel: null });
    expect(paymentMethodOf("Bankový prevod")).toEqual({ paymentMethod: "bank_transfer", paymentMethodLabel: null });
    expect(paymentMethodOf("transfer")).toEqual({ paymentMethod: "bank_transfer", paymentMethodLabel: null });
    expect(paymentMethodOf("Hotově")).toEqual({ paymentMethod: "cash", paymentMethodLabel: null });
    expect(paymentMethodOf("V hotovosti")).toEqual({ paymentMethod: "cash", paymentMethodLabel: null });
    expect(paymentMethodOf("Platební kartou")).toEqual({ paymentMethod: "card", paymentMethodLabel: null });
    expect(paymentMethodOf("Bankovní karta")).toEqual({ paymentMethod: "card", paymentMethodLabel: null });
    expect(paymentMethodOf("Dobírka")).toEqual({ paymentMethod: "cash_on_delivery", paymentMethodLabel: null });
    expect(paymentMethodOf("Cash on delivery")).toEqual({ paymentMethod: "cash_on_delivery", paymentMethodLabel: null });
    expect(paymentMethodOf("PayPal")).toEqual({ paymentMethod: "other", paymentMethodLabel: "PayPal" });
    expect(paymentMethodOf(" ")).toEqual({});
    expect(paymentMethodOf(undefined)).toEqual({});
  });
});

describe("parseReverseChargeCode", () => {
  it("accepts only codes EPO takes", () => {
    expect(parseReverseChargeCode("4")).toBe("4");
    expect(parseReverseChargeCode(" 1A ")).toBe("1a");
    expect(parseReverseChargeCode("4.0")).toBe("4");
    expect(parseReverseChargeCode("2")).toBeNull();
    expect(parseReverseChargeCode("99")).toBeNull();
    expect(parseReverseChargeCode("stavební práce")).toBeNull();
    expect(parseReverseChargeCode(undefined)).toBeNull();
  });
});

describe("mapInvoiceRows: document details", () => {
  const head = "Číslo;Odběratel;Vystaveno;Celkem bez DPH;Celkem;Měna";

  it("maps order number, internal note, payment method, constant symbol, issue place and issuer (CZ headers)", () => {
    const { invoices } = map(
      `${head};Číslo objednávky;Interní poznámka;Způsob úhrady;Konstantní symbol;Místo vystavení;Vystavil\n` +
        "A1;Alfa;1.1.2025;100;121;CZK;OBJ-7;platí pozdě;Hotově;308;Brno;Jana Nováková\n",
    );
    expect(invoices[0]).toMatchObject({
      orderNumber: "OBJ-7",
      internalNote: "platí pozdě",
      paymentMethod: "cash",
      paymentMethodLabel: null,
      constantSymbol: "0308",
      issuePlace: "Brno",
      issuedByName: "Jana Nováková",
    });
  });

  it("maps the same details from Slovak and English headers", () => {
    const sk = map(
      `${head};Číslo objednávky odberateľa;Interná poznámka;Spôsob úhrady;Konštantný symbol;Miesto vystavenia;Vyhotovil\n` +
        "A1;Alfa;1.1.2025;100;120;EUR;PO-1;pozn;Dobierka;0008;Žilina;Peter\n",
    ).invoices[0];
    expect(sk).toMatchObject({ orderNumber: "PO-1", internalNote: "pozn", paymentMethod: "cash_on_delivery", constantSymbol: "0008", issuePlace: "Žilina", issuedByName: "Peter" });
    const en = map(
      "Invoice number,Client,Issue date,Total,Order number,Private notes,Payment method,Constant symbol,Place of issue,Issued by\n" +
        "A1,Alfa,2025-01-01,100,PO-2,secret,Wise,1234,Praha,Eva\n",
    ).invoices[0];
    expect(en).toMatchObject({ orderNumber: "PO-2", internalNote: "secret", paymentMethod: "other", paymentMethodLabel: "Wise", constantSymbol: "1234", issuePlace: "Praha", issuedByName: "Eva" });
  });

  it("leaves the details out when the file has none, and drops an invalid constant symbol", () => {
    const [a, b] = map(`${head};KS\nA1;Alfa;1.1.2025;100;121;CZK;\nA2;Alfa;1.1.2025;100;121;CZK;12345\n`).invoices;
    for (const inv of [a!, b!]) {
      expect(inv.constantSymbol).toBeUndefined();
      expect(inv.orderNumber).toBeUndefined();
      expect(inv.paymentMethod).toBeUndefined();
      expect(inv.reverseCharge).toBeUndefined();
      expect(inv.exchangeRate).toBeUndefined();
    }
  });

  it("puts the buyer's phone on the contact and the contact person into its internal note", () => {
    const [a, b] = map(`${head};Telefon;Kontaktní osoba\nA1;Alfa;1.1.2025;100;121;CZK;+420 777 000 111;Petr Malý\nA2;Beta;1.1.2025;100;121;CZK;;\n`).invoices;
    expect(a!.customer).toMatchObject({ phone: "+420 777 000 111", internalNote: "Kontaktní osoba: Petr Malý" });
    expect(b!.customer.phone).toBeUndefined();
    expect(b!.customer.internalNote).toBeUndefined();
  });
});

describe("mapInvoiceRows: exchange rate", () => {
  const head = "Číslo;Odběratel;Vystaveno;Celkem;Měna";

  it("takes a plain rate column as a manual rate", () => {
    const inv = map(`${head};Kurz\nA1;Alfa;1.1.2025;100;EUR;25,125\n`).invoices[0]!;
    expect(inv).toMatchObject({ exchangeRate: 25.125, exchangeRateMode: "manual", exchangeRateDate: null });
    const en = map("Number,Client,Date,Total,Currency,Exchange rate\nA1,Alfa,2025-01-01,100,USD,23.4\n").invoices[0]!;
    expect(en).toMatchObject({ exchangeRate: 23.4, exchangeRateMode: "manual" });
  });

  it("stores a ČNB rate as one, with its list day", () => {
    const viaKind = map(`${head};Kurz;Typ kurzu;Datum kurzu\nA1;Alfa;1.1.2025;100;EUR;25,1;ČNB;31.12.2024\n`).invoices[0]!;
    expect(viaKind).toMatchObject({ exchangeRate: 25.1, exchangeRateMode: "cnb_daily", exchangeRateDate: "2024-12-31" });
    const viaHeader = map(`${head};Kurz ČNB\nA1;Alfa;1.1.2025;100;EUR;25,1\n`).invoices[0]!;
    expect(viaHeader).toMatchObject({ exchangeRate: 25.1, exchangeRateMode: "cnb_daily", exchangeRateDate: null });
    const manualKind = map(`${head};Kurz;Typ kurzu\nA1;Alfa;1.1.2025;100;EUR;25,1;vlastní\n`).invoices[0]!;
    expect(manualKind.exchangeRateMode).toBe("manual");
  });

  it("ignores a rate on CZK invoices and the placeholder 1", () => {
    const [czk, one] = map(`${head};Kurz\nA1;Alfa;1.1.2025;100;CZK;25\nA2;Alfa;1.1.2025;100;EUR;1\n`).invoices;
    expect(czk!.exchangeRate).toBeUndefined();
    expect(one!.exchangeRate).toBeUndefined();
  });
});

describe("mapInvoiceRows: reverse charge", () => {
  const head = "Číslo;Odběratel;Vystaveno;Celkem bez DPH;Celkem;Měna";

  it("reads the flag column in each language", () => {
    const rc = (header: string, value: string) => map(`${head};${header}\nA1;Alfa;1.1.2025;100;100;CZK;${value}\n`).invoices[0]!.reverseCharge;
    expect(rc("Přenesená daňová povinnost", "Ano")).toBe(true);
    expect(rc("PDP", "1")).toBe(true);
    expect(rc("Prenesenie daňovej povinnosti", "áno")).toBe(true);
    expect(rc("Reverse charge", "true")).toBe(true);
    expect(rc("Reverse charge", "no")).toBe(false);
  });

  it("trusts the flag even with VAT on the lines", () => {
    expect(map(`${head};PDP\nA1;Alfa;1.1.2025;100;121;CZK;ano\n`).invoices[0]!.reverseCharge).toBe(true);
  });

  it("lets the reverse-charge sentence set it only when no line has VAT", () => {
    const rows = map(
      `${head};Poznámka\n` +
        "A1;Alfa;1.1.2025;100;100;CZK;Daň odvede zákazník\n" +
        "A2;Alfa;1.1.2025;100;121;CZK;Daň odvede zákazník\n" +
        "A3;Alfa;1.1.2025;100;100;CZK;Děkujeme\n",
    ).invoices;
    expect(rows.map((i) => i.reverseCharge)).toEqual([true, undefined, undefined]);
  });

  it("reads the sentence typed into the flag column under the same rule", () => {
    const rows = map(`${head};Režim přenesení daňové povinnosti\nA1;Alfa;1.1.2025;100;100;CZK;Prenesenie daňovej povinnosti\nA2;Alfa;1.1.2025;100;121;CZK;reverse charge\n`).invoices;
    expect(rows.map((i) => i.reverseCharge)).toEqual([true, undefined]);
  });

  it("lets an explicit no win over the sentence", () => {
    expect(map(`${head};PDP;Poznámka\nA1;Alfa;1.1.2025;100;100;CZK;ne;reverse charge\n`).invoices[0]!.reverseCharge).toBe(false);
  });

  it("checks every line row of an invoice before the sentence counts", () => {
    const rows = map(
      "Číslo;Odběratel;Vystaveno;Položka;Cena za MJ;Sazba DPH;Poznámka\n" +
        "A1;Alfa;1.1.2025;Práce;100;0;Daň odvede zákazník\n" +
        "A1;;;Materiál;50;21;\n",
    ).invoices;
    expect(rows[0]!.lines).toHaveLength(2);
    expect(rows[0]!.reverseCharge).toBeUndefined();
  });

  it("keeps a valid KH code on a domestic reverse charge only", () => {
    const rows = map(
      `${head};PDP;Kód předmětu plnění;Země\n` +
        "A1;Alfa;1.1.2025;100;100;CZK;ano;4;CZ\n" +
        "A2;Alfa;1.1.2025;100;100;CZK;ano;99;CZ\n" +
        "A3;Alfa;1.1.2025;100;121;CZK;ne;4;CZ\n" +
        "A4;Alfa;1.1.2025;100;100;EUR;ano;4;DE\n",
    ).invoices;
    expect(rows.map((i) => i.reverseChargeCode)).toEqual(["4", undefined, undefined, undefined]);
    const en = map(`${head};Reverse charge;Supply code\nA1;Alfa;1.1.2025;100;100;CZK;yes;1a\n`).invoices[0]!;
    expect(en.reverseChargeCode).toBe("1a");
  });
});

describe("ownNumberSequence", () => {
  it("parses only our own number format", () => {
    expect(ownNumberSequence("2026-0042")).toEqual({ series: "", year: 2026, month: 0, sequence: 42 });
    expect(ownNumberSequence("ZF2026-0003")).toEqual({ series: "ZF", year: 2026, month: 0, sequence: 3 });
    expect(ownNumberSequence("FV-17")).toBeNull();
  });
});

describe("importedNumberSequence", () => {
  const formats = { invoice: "{N}/{MM}/{YYYY}", proforma: "ZF{YY}{NNNN}" };

  it("reads a number with the company's pattern for its document type", () => {
    expect(importedNumberSequence("4/10/2026", "invoice", formats)).toEqual({ series: "", year: 2026, month: 10, sequence: 4 });
    expect(importedNumberSequence("ZF260012", "proforma", formats)).toEqual({ series: "ZF", year: 2026, month: 0, sequence: 12 });
  });

  it("uses the document type's own series, not another type's pattern", () => {
    // A credit note keeps the built-in pattern, so "4/10/2026" says nothing about its counter.
    expect(importedNumberSequence("4/10/2026", "credit_note", formats)).toBeNull();
    expect(importedNumberSequence("OD2026-0002", "credit_note", formats)).toEqual({ series: "OD", year: 2026, month: 0, sequence: 2 });
  });

  it("falls back to the built-in format", () => {
    expect(importedNumberSequence("2026-0042", "invoice", formats)).toEqual({ series: "", year: 2026, month: 0, sequence: 42 });
    expect(importedNumberSequence("2026-0042", "invoice", {})).toEqual({ series: "", year: 2026, month: 0, sequence: 42 });
    expect(importedNumberSequence("4/10/2026", "invoice", {})).toBeNull();
  });
});

describe("highestImportedSequences", () => {
  it("keeps the highest sequence per series, year and month", () => {
    const formats = { invoice: "{N}/{MM}/{YYYY}" };
    const result = highestImportedSequences(
      [
        { invoiceNumber: "1/09/2026", documentType: "invoice" },
        { invoiceNumber: "7/09/2026", documentType: "invoice" },
        { invoiceNumber: "3/09/2026", documentType: "invoice" },
        { invoiceNumber: "2/10/2026", documentType: "invoice" },
        { invoiceNumber: "1/10/2026", documentType: "invoice" },
        { invoiceNumber: "5/10/2025", documentType: "invoice" },
        { invoiceNumber: "ZF2026-0009", documentType: "proforma" },
        { invoiceNumber: "něco jiného", documentType: "invoice" },
      ],
      formats,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        { series: "", year: 2026, month: 9, sequence: 7 },
        { series: "", year: 2026, month: 10, sequence: 2 },
        { series: "", year: 2025, month: 10, sequence: 5 },
        { series: "ZF", year: 2026, month: 0, sequence: 9 },
      ]),
    );
    expect(result).toHaveLength(4);
  });
});
