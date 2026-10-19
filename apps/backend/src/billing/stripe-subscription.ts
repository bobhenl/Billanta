import type Stripe from "stripe";
import type { ReferralPayment } from "../referrals/rewards";
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

/** Invoices for a period of the plan itself, not a proration or a one-off. */
const PLAN_PERIOD_REASONS = new Set(["subscription_create", "subscription_cycle"]);

/** A line covering more than this is a prepaid year, not a month (months run 28–31 days). */
const LONG_PERIOD_SECONDS = 32 * 24 * 60 * 60;

/**
 * A paid Stripe invoice as a referral payment (`record_referral_payment`),
 * or null when it does not count: a proration, a zero trial or coupon
 * invoice, a currency we don't price in. The amount is without VAT and never
 * more than what was actually charged. The period comes from the invoice
 * line, because `invoice.paid` can arrive before the checkout event that
 * stores the interval on the tenant.
 */
export function stripeInvoiceReferralPayment(invoice: Stripe.Invoice): ReferralPayment | null {
  if (!invoice.billing_reason || !PLAN_PERIOD_REASONS.has(invoice.billing_reason)) return null;
  const currency = (invoice.currency ?? "").toUpperCase();
  if (currency !== "CZK" && currency !== "EUR") return null;
  const paid = invoice.amount_paid ?? 0;
  const net = invoice.total_excluding_tax ?? paid;
  const amountMinor = Math.min(paid, net);
  if (amountMinor <= 0) return null;
  const period = invoice.lines?.data?.[0]?.period;
  const longPeriod = Boolean(period && period.end - period.start > LONG_PERIOD_SECONDS);
  return { amountMinor, currency, longPeriod };
}
