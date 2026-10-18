import { describe, expect, it } from "vitest";
import { decodeBankStatement, parseBankStatementCsv } from "./csv-parser";

const HEADER = "date,amount,currency,variable_symbol,counterparty_account,counterparty_name";

describe("parseBankStatementCsv", () => {
  it("parses a well-formed CSV into typed rows", () => {
    const csv = [
      HEADER,
      "2026-08-01,1500.00,CZK,1234567890,19-2000145399/0800,Novak Consulting sro",
      "2026-08-03,-450.50,CZK,,,",
    ].join("\n");

    const rows = parseBankStatementCsv(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      transactionDate: new Date("2026-08-01T00:00:00.000Z"),
      amount: "1500.00",
      currency: "CZK",
      variableSymbol: "1234567890",
      counterpartyAccount: "19-2000145399/0800",
      counterpartyName: "Novak Consulting sro",
      message: null,
    });
    expect(rows[1]).toEqual({
      transactionDate: new Date("2026-08-03T00:00:00.000Z"),
      amount: "-450.50",
      currency: "CZK",
      variableSymbol: null,
      counterpartyAccount: null,
      counterpartyName: null,
      message: null,
    });
  });

  it("accepts headers in a different order", () => {
    const csv = [
      "currency,date,amount,counterparty_name,counterparty_account,variable_symbol",
      "EUR,2026-08-01,10.00,Someone,,42",
    ].join("\n");

    const rows = parseBankStatementCsv(csv);

    expect(rows[0].currency).toBe("EUR");
    expect(rows[0].variableSymbol).toBe("42");
  });

  it("strips a leading UTF-8 BOM", () => {
    const csv = `﻿${HEADER}\n2026-08-01,1.00,CZK,,,`;

    const rows = parseBankStatementCsv(csv);

    expect(rows).toHaveLength(1);
  });

  it("rejects a CSV missing a required column", () => {
    const csv = "date,amount\n2026-08-01,10.00";

    expect(() => parseBankStatementCsv(csv)).toThrowError(/missing required column/i);
  });

  it("rejects rows with an invalid date, amount, or currency, reporting every bad row", () => {
    const csv = [
      HEADER,
      "not-a-date,10.00,CZK,,,",
      "2026-08-01,not-a-number,CZK,,,",
      "2026-08-01,10.00,TOOLONG,,,",
    ].join("\n");

    try {
      parseBankStatementCsv(csv);
      expect.fail("expected parseBankStatementCsv to throw");
    } catch (err: unknown) {
      const response = (err as { getResponse: () => { errors: string[] } }).getResponse();
      expect(response.errors).toHaveLength(3);
    }
  });

  it("rejects an empty file", () => {
    expect(() => parseBankStatementCsv("")).toThrowError(/empty/i);
  });

  it("rejects a header-only file with no data rows", () => {
    expect(() => parseBankStatementCsv(HEADER)).toThrowError(/no data rows/i);
  });
});

describe("parseBankStatementCsv with bank export formats", () => {
  it("reads a Fio CSV export: preamble, semicolons, Czech headers, dotted dates, decimal comma, bank code", () => {
    const csv = [
      '"accountId";"2900123456"',
      '"bankId";"2010"',
      '"currency";"CZK"',
      '"ID pohybu";"Datum";"Objem";"Měna";"Protiúčet";"Název protiúčtu";"Kód banky";"VS";"Poznámka"',
      '"2600001";"05.08.2026";"1 500,00";"CZK";"2000145399";"Novák s.r.o.";"0800";"2026001";"faktura"',
      '"2600002";"6.8.2026";"-250,5";"CZK";"";"";"";"";""',
      ";;;;;;;;",
    ].join("\r\n");

    const rows = parseBankStatementCsv(csv);

    expect(rows).toEqual([
      {
        transactionDate: new Date("2026-08-05T00:00:00.000Z"),
        amount: "1500.00",
        currency: "CZK",
        variableSymbol: "2026001",
        counterpartyAccount: "2000145399/0800",
        counterpartyName: "Novák s.r.o.",
        message: "faktura",
      },
      {
        transactionDate: new Date("2026-08-06T00:00:00.000Z"),
        amount: "-250.50",
        currency: "CZK",
        variableSymbol: null,
        counterpartyAccount: null,
        counterpartyName: null,
        message: null,
      },
    ]);
  });

  it("keeps an account that already has a bank code", () => {
    const csv = ["Datum;Částka;Měna;Protiúčet;Kód banky", "01.08.2026;10,00;CZK;123/0100;0800"].join("\n");

    expect(parseBankStatementCsv(csv)[0].counterpartyAccount).toBe("123/0100");
  });

  it("accepts thousands separators with dots or commas and a trailing currency code", () => {
    const csv = [
      "Datum zaúčtování\tSuma\tMena",
      "01.08.2026\t1.234,56\tEUR",
      "02.08.2026\t1,234.56\tEUR",
      "03.08.2026\t99,90 EUR\tEUR",
    ].join("\n");

    expect(parseBankStatementCsv(csv).map((row) => row.amount)).toEqual(["1234.56", "1234.56", "99.90"]);
  });

  it("does not need the optional columns", () => {
    const rows = parseBankStatementCsv("date,amount,currency\n2026-08-01,5,CZK");

    expect(rows[0]).toMatchObject({ amount: "5.00", variableSymbol: null, counterpartyName: null });
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(() => parseBankStatementCsv("datum;objem;mena\n31.02.2026;1;CZK")).toThrowError(/invalid rows/i);
  });

  it("decodes Windows-1250 files and leaves UTF-8 alone", () => {
    // "Měna" in Windows-1250: M, 0xEC, n, a
    const cp1250 = Buffer.from([0x4d, 0xec, 0x6e, 0x61]);
    expect(decodeBankStatement(cp1250)).toBe("Měna");
    expect(decodeBankStatement(Buffer.from("Měna", "utf-8"))).toBe("Měna");
  });
});
