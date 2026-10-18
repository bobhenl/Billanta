import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import { SubscriptionService } from "./subscription.service";

/** Every chain resolves to `result`; values inserted into platform_proformas are recorded. */
function fakeDb(result: unknown[]) {
  const inserted: Record<string, unknown>[] = [];
  const chain = (onValues?: (v: Record<string, unknown>) => void): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => {
        if (prop === "then") return (ok: (v: unknown) => void) => ok(result);
        return (arg: Record<string, unknown>) => {
          if (prop === "values") onValues?.(arg);
          return chain(onValues);
        };
      },
      apply: () => chain(onValues),
    });
  const db = {
    select: () => chain(),
    execute: () => chain(),
    update: () => chain(),
    insert: (table: unknown) => chain((v) => void (table === schema.platformProformas && inserted.push(v))),
  };
  return { db, inserted };
}

describe("SubscriptionService bank transfer", () => {
  beforeEach(() => {
    vi.stubEnv("PLATFORM_BILLING_NAME", "Billanta s.r.o.");
    vi.stubEnv("PLATFORM_BILLING_ICO", "12345678");
    vi.stubEnv("PLATFORM_BILLING_IBAN", "CZ6508000000192000145399");
    vi.stubEnv("PLATFORM_BILLING_VAT_RATE", "21");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const service = () => new SubscriptionService({ get: () => undefined } as never, {} as never);

  it("issues a month at the monthly transfer price (card price plus the surcharge)", async () => {
    const { db, inserted } = fakeDb([{ pending: 0, seq: "42" }]);
    await service().requestProforma(db as never, "tenant-1", "user-1", "start", 1);
    expect(inserted).toEqual([expect.objectContaining({ plan: "start", months: 1, amountMinor: 16400, vatRate: 21, totalMinor: 19844 })]);
  });

  it("still issues a year at the yearly transfer rate", async () => {
    const { db, inserted } = fakeDb([{ pending: 0, seq: "43" }]);
    await service().requestProforma(db as never, "tenant-1", "user-1", "plus", 12);
    expect(inserted).toEqual([expect.objectContaining({ plan: "plus", months: 12, amountMinor: 315600, totalMinor: 381876 })]);
  });

  it("shows the monthly and the yearly transfer amounts", async () => {
    const { db } = fakeDb([]);
    const tenant = { id: "tenant-1", plan: "free", stripeCustomerId: null, subscriptionInterval: null };
    vi.spyOn(SubscriptionService.prototype as never, "tenant").mockResolvedValue(tenant as never);
    const s = await service().status(db as never, "tenant-1");
    expect(s.bankTransfer).toMatchObject({
      enabled: true,
      amounts: { plus: { amountMinor: 315600 } },
      monthlyAmounts: { start: { amountMinor: 16400, totalMinor: 19844 }, plus: { amountMinor: 31800 }, business: { amountMinor: 63700 } },
    });
  });

  it("refuses a fourth open proforma", async () => {
    const { db, inserted } = fakeDb([{ pending: 3, seq: "44" }]);
    await expect(service().requestProforma(db as never, "tenant-1", "user-1", "plus", 1)).rejects.toMatchObject({ message: "too_many_pending_proformas" });
    expect(inserted).toEqual([]);
  });
});

describe("SubscriptionService card subscription", () => {
  afterEach(() => vi.restoreAllMocks());

  const tenant = { id: "tenant-1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionPlan: "plus" };
  function live(over: Record<string, unknown> = {}) {
    return {
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      cancel_at: null,
      cancel_at_period_end: false,
      metadata: { plan: "plus", interval: "month" },
      items: { data: [{ id: "si_1", current_period_end: 1_800_000_000, price: { currency: "czk", product: "prod_1", recurring: { interval: "month" } } }] },
      ...over,
    };
  }
  function setup(sub: Record<string, unknown>) {
    vi.spyOn(SubscriptionService.prototype as never, "tenant").mockResolvedValue(tenant as never);
    const stripe = {
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(sub),
        list: vi.fn().mockResolvedValue({ data: [] }),
        update: vi.fn().mockImplementation(async (_id: string, params: Record<string, unknown>) => ({ ...sub, ...params })),
      },
    };
    const service = new SubscriptionService({ get: () => "sk_test" } as never, stripe as never);
    return { service, stripe, db: fakeDb([]).db };
  }

  it("cancels at the period end without touching the price", async () => {
    const { service, stripe, db } = setup(live());
    const out = await service.setCancelAtPeriodEnd(db as never, "tenant-1", true);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(out.cancelAt).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it("resumes a plain cancel_at by unsetting it", async () => {
    const { service, stripe, db } = setup(live({ cancel_at: 1_790_000_000 }));
    await service.setCancelAtPeriodEnd(db as never, "tenant-1", false);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at: "" });
  });

  it("finds the running subscription by customer when the stored one has ended", async () => {
    const { service, stripe, db } = setup(live({ status: "canceled" }));
    stripe.subscriptions.list.mockResolvedValue({ data: [live({ id: "sub_2" })] });
    await service.setCancelAtPeriodEnd(db as never, "tenant-1", true);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_2", { cancel_at_period_end: true });
  });

  it("refuses when the company has no running subscription", async () => {
    const { service, db } = setup(live({ status: "canceled" }));
    await expect(service.setCancelAtPeriodEnd(db as never, "tenant-1", true)).rejects.toMatchObject({ message: "no_subscription" });
  });

  it("switches to yearly at the yearly card price on the same product", async () => {
    const { service, stripe, db } = setup(live());
    await service.changeInterval(db as never, "tenant-1", "year");
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({
        items: [{ id: "si_1", price_data: { currency: "czk", product: "prod_1", unit_amount: 239 * 12 * 100, recurring: { interval: "year" } } }],
        proration_behavior: "always_invoice",
      }),
    );
  });

  it("refuses to switch to the interval it already has, or while a payment is overdue", async () => {
    await expect(setup(live()).service.changeInterval({} as never, "tenant-1", "month")).rejects.toMatchObject({ message: "same_interval" });
    await expect(setup(live({ status: "past_due" })).service.changeInterval({} as never, "tenant-1", "year")).rejects.toMatchObject({
      message: "subscription_past_due",
    });
  });
});
