import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlanSummary } from "../billing/plan.guard";
import {
  amountPaidOnSeal,
  assertAmountsReadable,
  assertAmountsShape,
  assertAmountsWrite,
  refuseSealedRows,
  splitSealed,
} from "./sealed-amounts";
import { VaultService } from "./vault.service";

vi.mock("../billing/plan.guard", () => ({ loadPlanSummary: vi.fn() }));

const env = (n: number) => `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(20 + n)}` as const;
const placeholder = { quantity: "1.0000", unitPrice: "0.00", vatRate: null, discountPercent: "0.00" };
const sealedItem = (n: number) => ({ ...placeholder, encAmounts: env(n) });
const plainItem = { quantity: "2", unitPrice: "1500.00", vatRate: "21", discountPercent: "0" };

/** `.select().from().where().limit()` answering with the vault row. */
function vaultDb(categories: string[] | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where"]) chain[m] = () => chain;
  chain.limit = vi.fn(async () => (categories ? [{ categories }] : []));
  return chain as never;
}

const error = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e as Error;
  }
  return null;
};

describe("assertAmountsShape", () => {
  it("accepts a fully sealed document and a fully plain one", () => {
    expect(() => assertAmountsShape({ encAmounts: env(1) }, [sealedItem(2), sealedItem(3)])).not.toThrow();
    expect(() => assertAmountsShape({ encAmounts: null }, [plainItem])).not.toThrow();
  });

  it("refuses real numbers next to the envelopes (400 amounts_plaintext)", async () => {
    const e = await error(() => assertAmountsShape({ encAmounts: env(1) }, [{ ...plainItem, encAmounts: env(2) }]));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e?.message).toBe("amounts_plaintext");
  });

  it("refuses a plain item in a sealed document", async () => {
    expect((await error(() => assertAmountsShape({ encAmounts: env(1) }, [sealedItem(2), placeholder])))?.message).toBe("amounts_plaintext");
  });

  it("refuses a sealed item in a plain document (the server would sum it as 0)", async () => {
    expect((await error(() => assertAmountsShape({ encAmounts: null }, [sealedItem(2)])))?.message).toBe("amounts_plaintext");
  });

  it("refuses a plain paid sum on a sealed document", async () => {
    expect((await error(() => assertAmountsShape({ encAmounts: env(1), amountPaid: "500.00" }, [sealedItem(2)])))?.message).toBe("amounts_plaintext");
  });

  it("refuses a value that only looks like an envelope", async () => {
    expect((await error(() => assertAmountsShape({ encAmounts: "1234.50" }, [])))?.message).toBe("amounts_plaintext");
  });
});

describe("assertAmountsWrite", () => {
  const plan = vi.mocked(loadPlanSummary);
  beforeEach(() => {
    plan.mockReset();
    plan.mockResolvedValue({ plan: "plus", enforced: true } as never);
  });

  it("refuses plain amounts over sealed ones (409 amounts_sealed)", async () => {
    const e = await error(assertAmountsWrite(vaultDb(["amounts"]), "t1", { encAmounts: null, items: [plainItem] }, { encAmounts: env(1) }));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e?.message).toBe("amounts_sealed");
  });

  it("refuses sealing with the amounts category off (403 vault_category_off)", async () => {
    const e = await error(assertAmountsWrite(vaultDb(["texts"]), "t1", { encAmounts: env(1), items: [sealedItem(2)] }, null));
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(e?.message).toBe("vault_category_off");
  });

  it("refuses sealing without the plan", async () => {
    plan.mockResolvedValue({ plan: "start", enforced: true } as never);
    const e = await error(assertAmountsWrite(vaultDb(["amounts"]), "t1", { encAmounts: env(1), items: [sealedItem(2)] }, null));
    expect(e).toBeInstanceOf(ForbiddenException);
    expect((e as ForbiddenException).getResponse()).toMatchObject({ error: "plan_required", feature: "confidential_mode" });
  });

  it("stores sealed amounts with the plan and the category", async () => {
    await expect(assertAmountsWrite(vaultDb(["amounts"]), "t1", { encAmounts: env(1), items: [sealedItem(2)] }, null)).resolves.toBeUndefined();
  });

  it("keeps a sealed document editable after a downgrade or with the category off", async () => {
    plan.mockResolvedValue({ plan: "start", enforced: true } as never);
    await expect(assertAmountsWrite(vaultDb(["texts"]), "t1", { encAmounts: env(3), items: [sealedItem(4)] }, { encAmounts: env(1) })).resolves.toBeUndefined();
  });

  it("lets plain amounts save without any vault lookup", async () => {
    await assertAmountsWrite(vaultDb(null), "t1", { encAmounts: null, items: [plainItem] }, null);
    expect(plan).not.toHaveBeenCalled();
  });
});

describe("amountPaidOnSeal", () => {
  it("leaves an unpaid document alone and zeroes the paid sum of a paid one", () => {
    expect(amountPaidOnSeal({ status: "issued", amountPaid: "0.00" })).toBeNull();
    expect(amountPaidOnSeal({ status: "paid", amountPaid: "3630.00" })).toBe("0");
  });

  it("refuses a partly paid document (409 amounts_partly_paid)", async () => {
    const e = await error(() => amountPaidOnSeal({ status: "issued", amountPaid: "1000.00" }));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e?.message).toBe("amounts_partly_paid");
  });
});

describe("aggregates over sealed documents", () => {
  const rows = [
    { id: "a", encAmounts: null },
    { id: "b", encAmounts: env(1) },
    { id: "c", encAmounts: env(2) },
  ];

  it("splits the plain rows from the sealed ids", () => {
    const { plain, sealed } = splitSealed(rows);
    expect(plain.map((r) => r.id)).toEqual(["a"]);
    expect(sealed).toEqual({ count: 2, ids: ["b", "c"] });
  });

  it("refuses a one-piece file with sealed documents in it, naming them", async () => {
    const e = await error(() => refuseSealedRows(rows));
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({ message: "amounts_sealed", sealed: { count: 2, ids: ["b", "c"] } });
    expect(() => refuseSealedRows([rows[0]!])).not.toThrow();
  });

  it("refuses to print sealed amounts on the server (409 confidential_content)", async () => {
    expect((await error(() => assertAmountsReadable({ encAmounts: env(1) })))?.message).toBe("confidential_content");
    expect(() => assertAmountsReadable({ encAmounts: null })).not.toThrow();
  });
});

/** Answers each `.limit()` / `.returning()` / awaited query in turn with the next rows. */
function fakeDb(...answers: unknown[][]) {
  const wheres: SQL[] = [];
  const sets: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const next = () => Promise.resolve(answers.shift() ?? []);
  for (const m of ["select", "from", "innerJoin", "orderBy", "update"]) chain[m] = () => chain;
  chain.set = (v: unknown) => {
    sets.push(v);
    return chain;
  };
  chain.where = (w: SQL) => {
    wheres.push(w);
    return chain;
  };
  chain.limit = next;
  chain.returning = next;
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => next().then(resolve, reject);
  return { db: chain as never, wheres, sets };
}

const vaultRow = (categories: string[]) => [{ tenantId: "t1", categories }];
const doc = { id: "11111111-1111-4111-8111-111111111111", invoiceNumber: "2026001", status: "issued", amountPaid: "0.00", noteAbove: null, noteBelow: null };
const items = [
  { id: "22222222-2222-4222-8222-222222222222", description: "Konzultace" },
  { id: "33333333-3333-4333-8333-333333333333", description: "Doprava" },
];
const given = { id: doc.id, encAmounts: env(1), items: [{ id: items[0]!.id, encAmounts: env(2) }, { id: items[1]!.id, encAmounts: env(3) }] };

describe("VaultService.sealAmounts", () => {
  it("refuses without the amounts category (403 vault_category_off)", async () => {
    const { db, sets } = fakeDb(vaultRow(["texts"]), [{ categories: ["texts"] }]);
    const e = await new VaultService().sealAmounts(db, "t1", { invoices: [given] }).catch((x: Error) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
    expect((e as Error).message).toBe("vault_category_off");
    expect(sets).toEqual([]);
  });

  it("stores the envelopes, puts the placeholder in the plain columns, and only while still plain and unlocked", async () => {
    const { db, sets, wheres } = fakeDb(vaultRow(["amounts"]), [{ categories: ["amounts"] }], [doc], items, [{ id: doc.id }], [], []);
    const result = await new VaultService().sealAmounts(db, "t1", { invoices: [given] });
    expect(result).toEqual({ sealed: 1, skipped: 0 });
    expect(sets[0]).toEqual({ encAmounts: env(1) });
    expect(sets.slice(1)).toEqual([
      { quantity: "1", unitPrice: "0", vatRate: null, discountPercent: "0", encAmounts: env(2) },
      { quantity: "1", unitPrice: "0", vatRate: null, discountPercent: "0", encAmounts: env(3) },
    ]);
    // The document UPDATE re-checks its state, so a retry or a second tab writes nothing.
    const update = new PgDialect().sqlToQuery(wheres[4]!).sql;
    expect(update).toContain('"enc_amounts" is null');
    expect(update).toContain('"locked_at" is null');
  });

  it("is a no-op for a document sealed meanwhile (idempotent)", async () => {
    const { db, sets } = fakeDb(vaultRow(["amounts"]), [{ categories: ["amounts"] }], []);
    expect(await new VaultService().sealAmounts(db, "t1", { invoices: [given] })).toEqual({ sealed: 0, skipped: 0 });
    expect(sets).toEqual([]);
  });

  it("writes no item when the document UPDATE lost the race", async () => {
    const { db, sets } = fakeDb(vaultRow(["amounts"]), [{ categories: ["amounts"] }], [doc], items, []);
    expect(await new VaultService().sealAmounts(db, "t1", { invoices: [given] })).toEqual({ sealed: 0, skipped: 0 });
    expect(sets).toHaveLength(1);
  });

  it("skips a partly paid document untouched", async () => {
    const { db, sets } = fakeDb(vaultRow(["amounts"]), [{ categories: ["amounts"] }], [{ ...doc, amountPaid: "500.00" }]);
    expect(await new VaultService().sealAmounts(db, "t1", { invoices: [given] })).toEqual({ sealed: 0, skipped: 1 });
    expect(sets).toEqual([]);
  });

  it("zeroes the plain paid sum of a paid document", async () => {
    const { db, sets } = fakeDb(vaultRow(["amounts"]), [{ categories: ["amounts"] }], [{ ...doc, status: "paid", amountPaid: "3630.00" }], items, [{ id: doc.id }], [], []);
    await new VaultService().sealAmounts(db, "t1", { invoices: [given] });
    expect(sets[0]).toEqual({ encAmounts: env(1), amountPaid: "0" });
  });

  it("skips a document when not every item came back sealed", async () => {
    const { db, sets } = fakeDb(vaultRow(["amounts"]), [{ categories: ["amounts"] }], [doc], items);
    const partial = { ...given, items: given.items.slice(0, 1) };
    expect(await new VaultService().sealAmounts(db, "t1", { invoices: [partial] })).toEqual({ sealed: 0, skipped: 1 });
    expect(sets).toEqual([]);
  });

  it("leaves locked documents out of the query", async () => {
    const { db, wheres } = fakeDb(vaultRow(["amounts"]), [{ categories: ["amounts"] }], []);
    await new VaultService().sealAmounts(db, "t1", { invoices: [given] });
    expect(new PgDialect().sqlToQuery(wheres.at(-1)!).sql).toContain('"locked_at" is null');
  });
});

describe("VaultService.plainAmounts", () => {
  it("refuses without the amounts category (403 vault_category_off)", async () => {
    const { db } = fakeDb(vaultRow(["texts", "contacts"]));
    const e = await new VaultService().plainAmounts(db, "t1", { limit: 20 }).catch((x: Error) => x);
    expect((e as Error).message).toBe("vault_category_off");
  });
});
