import type Stripe from "stripe";
import type { BillingInterval } from "./plans";
import type { SubscriptionDetails } from "./tenant-billing.repository";

/** The one item our Checkout creates (`SubscriptionService.checkout`). */
export function subscriptionItem(sub: Stripe.Subscription): Stripe.SubscriptionItem | null {
  return sub.items?.data?.[0] ?? null;
}

/**
 * What the billing panel shows about a Stripe subscription. The period end
 * moved from the subscription to its items in API version 2025-03-31, so
 * both places are read. `cancel_at` is set for "cancel at period end" too on
 * current API versions; on older ones only the flag is, so the period end
 * stands in for it.
 */
export function stripeSubscriptionDetails(sub: Stripe.Subscription): SubscriptionDetails & { subscriptionInterval: BillingInterval | null } {
  const item = subscriptionItem(sub) as (Stripe.SubscriptionItem & { current_period_end?: number }) | null;
  const legacy = sub as Stripe.Subscription & { current_period_end?: number };
  const periodEnd = item?.current_period_end ?? legacy.current_period_end ?? null;
  const cancelAt = sub.cancel_at ?? (sub.cancel_at_period_end ? periodEnd : null);
  const currency = (item?.price?.currency ?? sub.currency ?? "").toUpperCase();
  const interval = item?.price?.recurring?.interval;
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  return {
    stripeSubscriptionId: sub.id,
    subscriptionCurrency: currency === "CZK" || currency === "EUR" ? currency : null,
    subscriptionPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    subscriptionCancelAt: !ended && cancelAt ? new Date(cancelAt * 1000) : null,
    subscriptionInterval: interval === "month" ? "month" : interval === "year" ? "year" : null,
  };
}
