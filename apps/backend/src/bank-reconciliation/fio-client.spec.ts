import { describe, expect, it, vi } from "vitest";
import { FioApiError, fetchFioStatement, parseFioStatement } from "./fio-client";

const body = {
  accountStatement: {
    info: { accountId: "2400012345", bankId: "2010", currency: "CZK" },
    transactionList: {
      transaction: [
        {
          column22: { value: 26962199069, name: "ID pohybu", id: 22 },
          column0: { value: "2026-09-30+0200", name: "Datum", id: 0 },
          column1: { value: 12100.5, name: "Objem", id: 1 },
          column14: { value: "CZK", name: "Měna", id: 14 },
          column2: { value: "123456789", name: "Protiúčet", id: 2 },
          column3: { value: "0100", name: "Kód banky", id: 3 },
          column10: { value: "Firma s.r.o.", name: "Název protiúčtu", id: 10 },
          column5: { value: "2026001", name: "VS", id: 5 },
        },
        {
          column22: { value: 26962199070, name: "ID pohybu", id: 22 },
          column0: { value: "2026-09-30+0200", name: "Datum", id: 0 },
          column1: { value: -500, name: "Objem", id: 1 },
        },
        {
          column22: { value: 26962199071, name: "ID pohybu", id: 22 },
          column0: { value: "2026-10-01+0200", name: "Datum", id: 0 },
          column1: { value: 99, name: "Objem", id: 1 },
          column5: null,
          column7: { value: "Jan Novák", name: "Uživatelská identifikace", id: 7 },
        },
      ],
    },
  },
};

describe("parseFioStatement", () => {
  it("maps incoming movements and drops outgoing ones", () => {
    const result = parseFioStatement(body);
    expect(result.accountNumber).toBe("2400012345/2010");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      externalId: "fio:26962199069",
      transactionDate: new Date(Date.UTC(2026, 8, 30)),
      amount: "12100.50",
      currency: "CZK",
      variableSymbol: "2026001",
      counterpartyAccount: "123456789/0100",
      counterpartyName: "Firma s.r.o.",
    });
    expect(result.rows[1]).toMatchObject({ amount: "99.00", variableSymbol: null, counterpartyName: "Jan Novák" });
  });

  it("handles an empty statement", () => {
    expect(parseFioStatement({ accountStatement: { info: {}, transactionList: { transaction: [] } } }).rows).toEqual([]);
  });

  it("rejects an unexpected body", () => {
    expect(() => parseFioStatement({})).toThrow(FioApiError);
  });
});

describe("fetchFioStatement", () => {
  const token = "a".repeat(64);

  it("calls the periods endpoint for the given days", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await fetchFioStatement(token, new Date("2026-09-01T10:00:00Z"), new Date("2026-10-01T10:00:00Z"), fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `https://fioapi.fio.cz/v1/rest/periods/${token}/2026-09-01/2026-10-01/transactions.json`,
    );
  });

  it("maps 409 to rate_limited and 4xx to invalid_token", async () => {
    const rateLimited = vi.fn().mockResolvedValue(new Response("", { status: 409 }));
    await expect(fetchFioStatement(token, new Date(), new Date(), rateLimited)).rejects.toMatchObject({ code: "rate_limited" });
    const bad = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(fetchFioStatement(token, new Date(), new Date(), bad)).rejects.toMatchObject({ code: "invalid_token" });
  });
});
