import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { stripeSubscriptionDetails } from "./stripe-subscription";

const END = 1_800_000_000;

function sub(over: Record<string, unknown> = {}, item: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    cancel_at: null,
    cancel_at_period_end: false,
    items: { data: [{ id: "si_1", current_period_end: END, price: { currency: "czk", recurring: { interval: "year" } }, ...item }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

describe("stripeSubscriptionDetails", () => {
  it("reads the period end, currency and interval from the item", () => {
    expect(stripeSubscriptionDetails(sub())).toEqual({
      stripeSubscriptionId: "sub_1",
      subscriptionCurrency: "CZK",
      subscriptionPeriodEnd: new Date(END * 1000),
      subscriptionCancelAt: null,
      subscriptionInterval: "year",
    });
  });

  it("falls back to the subscription's own period end on older API versions", () => {
    const s = sub({ current_period_end: END + 60 }, { current_period_end: undefined });
    expect(stripeSubscriptionDetails(s).subscriptionPeriodEnd).toEqual(new Date((END + 60) * 1000));
  });

  it("uses the period end as the cancel date when only the flag is set", () => {
    expect(stripeSubscriptionDetails(sub({ cancel_at_period_end: true })).subscriptionCancelAt).toEqual(new Date(END * 1000));
  });

  it("prefers an explicit cancel_at over the period end", () => {
    expect(stripeSubscriptionDetails(sub({ cancel_at: END - 100 })).subscriptionCancelAt).toEqual(new Date((END - 100) * 1000));
  });

  it("drops the cancel date once the subscription has ended", () => {
    expect(stripeSubscriptionDetails(sub({ status: "canceled", cancel_at: END })).subscriptionCancelAt).toBeNull();
  });

  it("leaves out currencies and intervals we do not sell", () => {
    const d = stripeSubscriptionDetails(sub({}, { price: { currency: "usd", recurring: { interval: "week" } } }));
    expect(d.subscriptionCurrency).toBeNull();
    expect(d.subscriptionInterval).toBeNull();
  });
});
