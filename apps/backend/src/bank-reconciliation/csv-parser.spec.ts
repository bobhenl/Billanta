import { describe, expect, it } from "vitest";
import { parseBankStatementCsv } from "./csv-parser";

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
    });
    expect(rows[1]).toEqual({
      transactionDate: new Date("2026-08-03T00:00:00.000Z"),
      amount: "-450.50",
      currency: "CZK",
      variableSymbol: null,
      counterpartyAccount: null,
      counterpartyName: null,
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
