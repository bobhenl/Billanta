import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../drizzle/schema";
import { CardPaymentsService, cardPaymentRecord, feeOf, fromMinor, toMinor } from "./card-payments.service";

const session = (balance: Partial<Stripe.BalanceTransaction> | null) =>
  ({
    payment_intent: { latest_charge: { balance_transaction: balance } },
  }) as unknown as Stripe.Checkout.Session;

describe("minor units", () => {
  it("uses cents except for zero-decimal currencies", () => {
    expect(toMinor(1234.5, "CZK")).toBe(123450);
    expect(toMinor(19.99, "eur")).toBe(1999);
    expect(toMinor(500, "JPY")).toBe(500);
    expect(fromMinor(123450, "CZK")).toBe(1234.5);
  });
});

describe("feeOf", () => {
  it("returns the fee in the invoice currency", () => {
    expect(feeOf(session({ fee: 3725, currency: "czk", exchange_rate: null }), "CZK")).toBe(37.25);
  });

  it("converts a fee settled in another currency back through exchange_rate", () => {
    // 100 EUR charge settled in CZK at 25 CZK/EUR, fee 75 CZK -> 3 EUR.
    expect(feeOf(session({ fee: 7500, currency: "czk", exchange_rate: 25 }), "EUR")).toBe(3);
  });

  it("is null when Stripe didn't expand the balance transaction", () => {
    expect(feeOf(session(null), "CZK")).toBeNull();
    expect(feeOf({ payment_intent: "pi_123" } as unknown as Stripe.Checkout.Session, "CZK")).toBeNull();
  });
});

describe("CardPaymentsService.connect", () => {
  const db = () => {
    const where = vi.fn().mockResolvedValue([{ key: null, name: null, enabled: false }]);
    return {
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    };
  };
  const make = (stripe: unknown) => new CardPaymentsService({} as never, {} as never, () => stripe as Stripe);

  it("rejects something that isn't a Stripe secret key without calling Stripe", async () => {
    const factory = vi.fn();
    const service = new CardPaymentsService({} as never, {} as never, factory);
    await expect(service.connect(db() as never, "t", "pk_test_publishable")).rejects.toThrow("invalid_key_format");
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects a key Stripe refuses", async () => {
    const stripe = { accounts: { retrieveCurrent: vi.fn().mockRejectedValue({ type: "StripeAuthenticationError" }) } };
    await expect(make(stripe).connect(db() as never, "t", "sk_test_" + "a".repeat(24))).rejects.toThrow("invalid_key");
  });

  it("accepts a restricted key without account access when Checkout works", async () => {
    const stripe = {
      accounts: { retrieveCurrent: vi.fn().mockRejectedValue({ type: "StripePermissionError" }) },
      checkout: { sessions: { list: vi.fn().mockResolvedValue({ data: [] }) } },
    };
    const tenantDb = db();
    process.env.BACKUP_CONFIG_ENCRYPTION_KEY ??= "0".repeat(64);
    await make(stripe).connect(tenantDb as never, "t", "rk_test_" + "b".repeat(24));
    expect(stripe.checkout.sessions.list).toHaveBeenCalled();
    expect(tenantDb.update).toHaveBeenCalled();
  });
});

describe("cardPaymentRecord", () => {
  it("keeps the charged amount on a sealed document's payment, waiting to be sealed", () => {
    expect(cardPaymentRecord(1210, 18.15, true)).toEqual({ fee: "18.15", amount: "1210.00", sealState: "pending" });
  });

  it("stores just the fee for a readable document, whose payment goes into amount_paid", () => {
    expect(cardPaymentRecord(1210, null, false)).toEqual({ fee: null });
  });
});

describe("a paid card checkout of a sealed document", () => {
  const ENC = "enc:v1:AAAAAAAAAAAAAAAA:QUJD:" + "A".repeat(16) + ":" + "A".repeat(64);
  const row = { id: "s1", invoiceId: "inv1", sessionId: "cs_test_1", amount: "1210.00", currency: "CZK", status: "open" } as never;
  const paidSession = {
    metadata: { invoice_id: "inv1" },
    status: "complete",
    payment_status: "paid",
    amount_total: 121000,
    payment_intent: { latest_charge: { balance_transaction: { fee: 1815, currency: "czk", exchange_rate: null } } },
  };

  /** The session row as Postgres keeps it: the claim only takes an open one. */
  function setup(encAmounts: string | null) {
    const state = { status: "open" as string, sets: [] as Record<string, unknown>[] };
    const db = {
      select: () => ({ from: (t: unknown) => ({ where: async () => (t === schema.invoices ? [{ encAmounts }] : []) }) }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (where: SQL) => ({
            returning: async () => {
              if (new PgDialect().sqlToQuery(where).params.includes("open") && state.status !== "open") return [];
              state.status = String(set.status);
              state.sets.push(set);
              return [{ id: "s1" }];
            },
          }),
        }),
      }),
    };
    const invoices = { markPaid: vi.fn(async () => ({})) };
    const stripe = { checkout: { sessions: { retrieve: vi.fn(async () => paidSession) } } };
    const service = new CardPaymentsService({} as never, invoices as never, () => stripe as never);
    const check = () => (service as unknown as { check: (...a: unknown[]) => Promise<string> }).check(db, stripe, row);
    return { state, invoices, check };
  }

  it("books the document paid without a sum and keeps the payment waiting to be sealed", async () => {
    const { state, invoices, check } = setup(ENC);
    expect(await check()).toBe("paid");
    expect(invoices.markPaid).toHaveBeenCalledWith(expect.anything(), "inv1", expect.any(Date));
    expect(state.sets).toEqual([expect.objectContaining({ status: "paid", amount: "1210.00", fee: "18.15", sealState: "pending" })]);
  });

  it("records it once when the return page, the sweep or a retry ask again", async () => {
    const { state, invoices, check } = setup(ENC);
    await check();
    expect(await check()).toBe("paid");
    expect(await check()).toBe("paid");
    expect(state.sets).toHaveLength(1);
    expect(invoices.markPaid).toHaveBeenCalledTimes(1);
  });

  it("leaves a readable document's payment out of the queue", async () => {
    const { state, invoices, check } = setup(null);
    await check();
    expect(state.sets[0]).not.toHaveProperty("sealState");
    expect(invoices.markPaid).toHaveBeenCalledWith(expect.anything(), "inv1", expect.any(Date), 1210, { fee: 18.15 });
  });
});
