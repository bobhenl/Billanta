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

  it("issues a month at the monthly price", async () => {
    const { db, inserted } = fakeDb([{ pending: 0, seq: "42" }]);
    await service().requestProforma(db as never, "tenant-1", "user-1", "start", 1);
    expect(inserted).toEqual([expect.objectContaining({ plan: "start", months: 1, amountMinor: 14900, vatRate: 21, totalMinor: 18029 })]);
  });

  it("still issues a year at the yearly rate", async () => {
    const { db, inserted } = fakeDb([{ pending: 0, seq: "43" }]);
    await service().requestProforma(db as never, "tenant-1", "user-1", "plus", 12);
    expect(inserted).toEqual([expect.objectContaining({ plan: "plus", months: 12, amountMinor: 286800, totalMinor: 347028 })]);
  });

  it("shows the monthly and the yearly transfer amounts", async () => {
    const { db } = fakeDb([]);
    const tenant = { id: "tenant-1", plan: "free", stripeCustomerId: null, subscriptionInterval: null };
    vi.spyOn(SubscriptionService.prototype as never, "tenant").mockResolvedValue(tenant as never);
    const s = await service().status(db as never, "tenant-1");
    expect(s.bankTransfer).toMatchObject({
      enabled: true,
      amounts: { plus: { amountMinor: 286800 } },
      monthlyAmounts: { start: { amountMinor: 14900, totalMinor: 18029 }, plus: { amountMinor: 28900 }, business: { amountMinor: 57900 } },
    });
  });

  it("refuses a fourth open proforma", async () => {
    const { db, inserted } = fakeDb([{ pending: 3, seq: "44" }]);
    await expect(service().requestProforma(db as never, "tenant-1", "user-1", "plus", 1)).rejects.toMatchObject({ message: "too_many_pending_proformas" });
    expect(inserted).toEqual([]);
  });
});
