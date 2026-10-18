import { describe, expect, it } from "vitest";
import { splitDuplicates, type DedupeRow, type StoredDedupeRow } from "./dedupe";

const day = new Date(Date.UTC(2026, 8, 30));

function row(overrides: Partial<DedupeRow> = {}): DedupeRow {
  return {
    transactionDate: day,
    amount: "1210.05",
    currency: "CZK",
    variableSymbol: "2026001",
    counterpartyAccount: "19-123457/0800",
    externalId: null,
    ...overrides,
  };
}

let nextId = 0;
function stored(overrides: Partial<StoredDedupeRow> = {}): StoredDedupeRow {
  return { ...row(), id: `s${++nextId}`, externalId: null, ...overrides };
}

describe("splitDuplicates", () => {
  it("drops a row whose bank id is already stored", () => {
    const result = splitDuplicates([row({ externalId: "fio:1" }), row({ externalId: "fio:2", amount: "5.00" })], [
      stored({ externalId: "fio:1" }),
    ]);
    expect(result.fresh.map((r) => r.externalId)).toEqual(["fio:2"]);
    expect(result.duplicates).toBe(1);
  });

  it("recognises the same file uploaded twice, twins included", () => {
    const first = [row(), row(), row({ amount: "99.00" })];
    const storedRows = first.map((r) => stored(r as Partial<StoredDedupeRow>));
    const again = splitDuplicates([row(), row(), row({ amount: "99.00" })], storedRows);
    expect(again.fresh).toEqual([]);
    expect(again.duplicates).toBe(3);
  });

  it("keeps the second twin when only one was stored before", () => {
    const result = splitDuplicates([row(), row()], [stored()]);
    expect(result.fresh).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });

  it("matches an upload against API rows even though the account is spelled differently", () => {
    const result = splitDuplicates(
      [row({ counterpartyAccount: "CZ1408000000190000123457", variableSymbol: "0002026001", externalId: "camt:REF-1" })],
      [stored({ externalId: "fio:26962199069" })],
    );
    expect(result.fresh).toEqual([]);
    expect(result.claims).toEqual([]);
  });

  it("lets an API row take over a CSV row's place and id, so its twin later still comes in", () => {
    const csvRow = stored();
    const first = splitDuplicates([row({ externalId: "fio:1" })], [csvRow]);
    expect(first.fresh).toEqual([]);
    expect(first.claims).toEqual([{ id: csvRow.id, externalId: "fio:1" }]);

    // The next sync brings the payer's second, identical payment.
    const second = splitDuplicates([row({ externalId: "fio:2" })], [{ ...csvRow, externalId: "fio:1" }]);
    expect(second.fresh.map((r) => r.externalId)).toEqual(["fio:2"]);
  });

  it("never treats a row from the same source with a different id as a copy", () => {
    const result = splitDuplicates([row({ externalId: "fio:2" })], [stored({ externalId: "fio:1" })]);
    expect(result.fresh).toHaveLength(1);
    expect(result.duplicates).toBe(0);
  });

  it("does not absorb a payment with a different amount, day or VS", () => {
    const result = splitDuplicates(
      [row({ amount: "1210.06" }), row({ transactionDate: new Date(Date.UTC(2026, 9, 1)) }), row({ variableSymbol: "2026002" })],
      [stored()],
    );
    expect(result.fresh).toHaveLength(3);
  });

  it("drops a repeated id inside one batch", () => {
    const result = splitDuplicates([row({ externalId: "gpc:7" }), row({ externalId: "gpc:7" })], []);
    expect(result.fresh).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });
});
