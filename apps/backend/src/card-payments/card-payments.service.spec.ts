import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { CardPaymentsService, feeOf, fromMinor, toMinor } from "./card-payments.service";

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
