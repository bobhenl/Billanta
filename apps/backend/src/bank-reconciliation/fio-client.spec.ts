import { describe, expect, it, vi } from "vitest";
import {
  FioApiError,
  fetchFioLast,
  fioCursorAfterFetch,
  parseFioStatement,
  planFioStep,
  setFioLastDate,
  setFioLastId,
} from "./fio-client";

const body = {
  accountStatement: {
    info: { accountId: "2400012345", bankId: "2010", currency: "CZK", idLastDownload: 26962199000 },
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
          column16: { value: "Faktura 2026001", name: "Zpráva pro příjemce", id: 16 },
        },
        {
          column22: { value: 26962199071, name: "ID pohybu", id: 22 },
          column0: { value: "2026-10-01+0200", name: "Datum", id: 0 },
          column1: { value: 99, name: "Objem", id: 1 },
          column5: null,
          column7: { value: "Jan Novák", name: "Uživatelská identifikace", id: 7 },
        },
        // Outgoing and the newest: dropped from rows, but still moves the cursor.
        {
          column22: { value: 26962199080, name: "ID pohybu", id: 22 },
          column0: { value: "2026-10-01+0200", name: "Datum", id: 0 },
          column1: { value: -500, name: "Objem", id: 1 },
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
      message: "Faktura 2026001",
    });
    expect(result.rows[1]).toMatchObject({ amount: "99.00", variableSymbol: null, counterpartyName: "Jan Novák", message: null });
  });

  it("reports the newest movement id, outgoing ones included, and Fio's cursor", () => {
    const result = parseFioStatement(body);
    expect(result.lastMovementId).toBe(26962199080);
    expect(result.idLastDownload).toBe(26962199000);
  });

  it("handles an empty statement", () => {
    const empty = parseFioStatement({ accountStatement: { info: {}, transactionList: { transaction: [] } } });
    expect(empty.rows).toEqual([]);
    expect(empty.lastMovementId).toBeNull();
  });

  it("rejects an unexpected body", () => {
    expect(() => parseFioStatement({})).toThrow(FioApiError);
  });
});

describe("Fio requests", () => {
  const token = "a".repeat(64);
  const ok = () => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

  it("reads from the cursor with `last`", async () => {
    const fetchImpl = ok();
    const result = await fetchFioLast(token, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://fioapi.fio.cz/v1/rest/last/${token}/transactions.json`);
    expect(result.rows).toHaveLength(2);
  });

  it("moves the cursor by id and by date", async () => {
    const byId = ok();
    await setFioLastId(token, 26962199069, byId);
    expect(byId.mock.calls[0][0]).toBe(`https://fioapi.fio.cz/v1/rest/set-last-id/${token}/26962199069/`);
    const byDate = ok();
    await setFioLastDate(token, new Date("2026-09-01T22:00:00Z"), byDate);
    expect(byDate.mock.calls[0][0]).toBe(`https://fioapi.fio.cz/v1/rest/set-last-date/${token}/2026-09-01/`);
  });

  it("maps 409, 422 and 4xx to stable codes", async () => {
    const status = (s: number) => vi.fn().mockResolvedValue(new Response("", { status: s }));
    await expect(fetchFioLast(token, status(409))).rejects.toMatchObject({ code: "rate_limited" });
    await expect(fetchFioLast(token, status(422))).rejects.toMatchObject({ code: "history_locked" });
    await expect(fetchFioLast(token, status(404))).rejects.toMatchObject({ code: "invalid_token" });
    await expect(fetchFioLast(token, status(500))).rejects.toMatchObject({ code: "unavailable" });
  });

  it("never puts the token into an error message", async () => {
    for (const s of [409, 422, 404, 500]) {
      const error = await fetchFioLast(token, vi.fn().mockResolvedValue(new Response("", { status: s }))).catch((e) => e);
      expect(String(error.message)).not.toContain(token);
    }
    const offline = await fetchFioLast(token, vi.fn().mockRejectedValue(new Error(`fetch failed for /last/${token}/`))).catch((e) => e);
    expect(offline.code).toBe("unavailable");
    expect(String(offline.message)).not.toContain(token);
  });
});

describe("planFioStep", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  it("reads when the cursor is known", () => {
    expect(planFioStep({ fioLastId: 5, fioCursorReady: true, lastSyncedAt: now }, now)).toEqual({ kind: "last" });
  });

  it("rewinds to the last stored movement when the cursor is unknown", () => {
    expect(planFioStep({ fioLastId: 5, fioCursorReady: false, lastSyncedAt: now }, now)).toEqual({ kind: "set-last-id", id: 5 });
  });

  it("starts 30 days back on a first sync", () => {
    const step = planFioStep({ fioLastId: null, fioCursorReady: false, lastSyncedAt: null }, now);
    expect(step).toEqual({ kind: "set-last-date", day: new Date("2026-09-18T12:00:00Z") });
  });

  it("overlaps the last sync by three days, but never asks for more than 89 days", () => {
    const recent = planFioStep({ fioLastId: null, fioCursorReady: false, lastSyncedAt: new Date("2026-10-10T12:00:00Z") }, now);
    expect(recent).toEqual({ kind: "set-last-date", day: new Date("2026-10-07T12:00:00Z") });
    const old = planFioStep({ fioLastId: null, fioCursorReady: false, lastSyncedAt: new Date("2026-01-01T00:00:00Z") }, now);
    expect(old).toEqual({ kind: "set-last-date", day: new Date("2026-07-21T12:00:00Z") });
  });
});

describe("fioCursorAfterFetch", () => {
  it("moves to the newest movement", () => {
    expect(fioCursorAfterFetch(100, { lastMovementId: 140, idLastDownload: 100 })).toEqual({ fioLastId: 140, fioCursorReady: true });
    expect(fioCursorAfterFetch(100, { lastMovementId: 140, idLastDownload: 140 })).toEqual({ fioLastId: 140, fioCursorReady: true });
  });

  it("keeps the id when nothing came", () => {
    expect(fioCursorAfterFetch(100, { lastMovementId: null, idLastDownload: 100 })).toEqual({ fioLastId: 100, fioCursorReady: true });
  });

  it("accepts any cursor on the very first read", () => {
    expect(fioCursorAfterFetch(null, { lastMovementId: 140, idLastDownload: 7 })).toEqual({ fioLastId: 140, fioCursorReady: true });
  });

  it("rewinds when the cursor moved without us", () => {
    // Another app read 100..120 with the same token; we only got 121..140.
    expect(fioCursorAfterFetch(100, { lastMovementId: 140, idLastDownload: 120 })).toEqual({ fioLastId: 100, fioCursorReady: false });
  });
});
