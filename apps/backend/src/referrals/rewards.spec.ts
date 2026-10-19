import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { stripeInvoiceReferralPayment } from "../billing/stripe-subscription";
import { platformAdminEmails } from "../partners/platform-admin.guard";
import { partnerSchema } from "../partners/partners.service";
import { visitorIp } from "../guest-invoices/guest-limits";
import {
  paymentCzk,
  planCost,
  REFERRAL_REWARDS,
  referralPaymentArgs,
  referralRewardCredits,
  REWARD_HOLD_DAYS,
  rewardReleaseAfter,
} from "./rewards";

const MIGRATIONS = join(__dirname, "../../drizzle/migrations");

/** Body of the newest migration that (re)defines `name`, whitespace collapsed. */
function latestFunction(name: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().reverse();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const start = sql.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION ${name}\\(`));
    if (start >= 0) return sql.slice(start, sql.indexOf("$$;", start)).replace(/\s+/g, " ");
  }
  throw new Error(`${name} not found`);
}

const DAY = 24 * 60 * 60 * 1000;

describe("referral reward", () => {
  it("is what the invited company paid first, never more than the cap", () => {
    // Start monthly: 149 Kč paid, the inviter gets 149, not the 289 cap.
    expect(referralRewardCredits("friend", 149)).toBe(149);
    expect(referralRewardCredits("friend", 289)).toBe(289);
    // A year of Plus paid at once is far over the cap.
    expect(referralRewardCredits("friend", 2868)).toBe(289);
    expect(referralRewardCredits("accountant", 2868)).toBe(289);
    expect(referralRewardCredits("accountant", 289)).toBe(289);
  });

  it("pays an approved accountant the same as anyone else", () => {
    expect(REFERRAL_REWARDS.accountant).toEqual({ welcome: 149, reward: 289 });
    expect(REFERRAL_REWARDS.accountant).toEqual(REFERRAL_REWARDS.friend);
  });

  it("is nothing for a zero or broken amount", () => {
    expect(referralRewardCredits("friend", 0)).toBe(0);
    expect(referralRewardCredits("friend", -10)).toBe(0);
    expect(referralRewardCredits("friend", Number.NaN)).toBe(0);
    expect(referralPaymentArgs({ amountMinor: 0, currency: "CZK", longPeriod: false }, new Date())).toBeNull();
  });

  it("counts whole koruny, and EUR at the price list's own rate", () => {
    expect(paymentCzk(14_999, "CZK")).toBe(149);
    // Plus monthly costs the same reward in either currency.
    expect(paymentCzk(1199, "EUR")).toBe(289);
    expect(paymentCzk(599, "EUR")).toBe(144);
  });

  it("waits for a second payment on a monthly plan and 30 days on a longer one", () => {
    const paidAt = new Date("2026-10-01T10:00:00Z");
    expect(rewardReleaseAfter(false, paidAt)).toBeNull();
    expect(REWARD_HOLD_DAYS).toBe(30);
    expect(rewardReleaseAfter(true, paidAt)!.getTime()).toBe(paidAt.getTime() + 30 * DAY);

    const yearly = referralPaymentArgs({ amountMinor: 286_800, currency: "CZK", longPeriod: true }, paidAt)!;
    expect(yearly).toEqual({ friend: 289, accountant: 289, releaseAfter: new Date(paidAt.getTime() + 30 * DAY) });
    const monthly = referralPaymentArgs({ amountMinor: 14_900, currency: "CZK", longPeriod: false }, paidAt)!;
    expect(monthly).toEqual({ friend: 149, accountant: 149, releaseAfter: null });
  });
});

describe("referral reward release (migration SQL)", () => {
  it("fixes the reward at the first payment and pays it on the second", () => {
    const fn = latestFunction("record_referral_payment");
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET first_paid_at = now\(\), paid_count = 1, pending_credits = v_credits, release_after = p_release_after/);
    expect(fn).toMatch(
      /IF r\.paid_count \+ 1 >= 2 AND \(r\.release_after IS NULL OR r\.release_after <= now\(\)\) THEN RETURN release_referral_reward\(r\.id\)/,
    );
  });

  it("pays a held-back reward only when it is due and still standing", () => {
    const fn = latestFunction("release_due_referral_rewards");
    expect(fn).toMatch(/rewarded_at IS NULL AND voided_at IS NULL AND first_paid_at IS NOT NULL AND release_after <= now\(\)/);
    const pay = latestFunction("release_referral_reward");
    expect(pay).toMatch(/rewarded_at IS NULL/);
    expect(pay).toMatch(/voided_at IS NULL/);
  });

  it("voids only a reward that is earned but not yet paid", () => {
    const fn = latestFunction("void_referral_reward");
    expect(fn).toMatch(/first_paid_at IS NOT NULL/);
    expect(fn).toMatch(/rewarded_at IS NULL/);
  });

  it("keeps the payout function away from the app role", () => {
    const grants = readFileSync(join(__dirname, "../../drizzle/app-role-grants.sql"), "utf8");
    const all = grants.indexOf("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO faktur_app;");
    const revoke = grants.indexOf("REVOKE EXECUTE ON FUNCTION release_referral_reward(uuid) FROM faktur_app;");
    expect(all).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(all);
  });
});

describe("stripeInvoiceReferralPayment", () => {
  // Loose on purpose: a fixture carries only the fields the mapper reads.
  const invoice = (over: Record<string, unknown>) =>
    ({
      billing_reason: "subscription_create",
      currency: "czk",
      amount_paid: 34_969,
      total_excluding_tax: 28_900,
      lines: { data: [{ period: { start: 0, end: 30 * 86_400 } }] },
      ...over,
    }) as unknown as Stripe.Invoice;

  it("takes the amount without VAT and the period from the line", () => {
    expect(stripeInvoiceReferralPayment(invoice({}))).toEqual({ amountMinor: 28_900, currency: "CZK", longPeriod: false });
    expect(stripeInvoiceReferralPayment(invoice({ lines: { data: [{ period: { start: 0, end: 365 * 86_400 } }] } }))?.longPeriod).toBe(true);
  });

  it("never counts more than was charged", () => {
    // A coupon took most of it: 50 Kč charged on a 289 Kč plan.
    expect(stripeInvoiceReferralPayment(invoice({ amount_paid: 5000 }))?.amountMinor).toBe(5000);
  });

  it("skips prorations, zero invoices and unknown currencies", () => {
    expect(stripeInvoiceReferralPayment(invoice({ billing_reason: "subscription_update" }))).toBeNull();
    expect(stripeInvoiceReferralPayment(invoice({ amount_paid: 0 }))).toBeNull();
    expect(stripeInvoiceReferralPayment(invoice({ currency: "usd" }))).toBeNull();
  });
});

describe("planCost", () => {
  it("charges a month at the monthly price and a year at the yearly rate", () => {
    expect(planCost("start", 1)).toBe(149);
    expect(planCost("plus", 12)).toBe(239 * 12);
  });

  it("caps the inviter above the welcome bonus", () => {
    expect(REFERRAL_REWARDS.friend.reward).toBeGreaterThan(REFERRAL_REWARDS.friend.welcome);
  });
});

describe("partners", () => {
  it("accepts only http(s) partner URLs", () => {
    const base = { slug: "abc", name: "ABC" };
    expect(partnerSchema.safeParse({ ...base, url: "https://abc.cz" }).success).toBe(true);
    expect(partnerSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success).toBe(false);
    expect(partnerSchema.safeParse({ ...base, url: "https://abc.cz", logo_url: "data:image/png;base64,x" }).success).toBe(false);
  });

  it("rejects slugs that aren't lowercase kebab", () => {
    expect(partnerSchema.safeParse({ slug: "-x", name: "X", url: "https://x.cz" }).success).toBe(false);
    expect(partnerSchema.safeParse({ slug: "Moje-Banka", name: "X", url: "https://x.cz" }).data?.slug).toBe("moje-banka");
  });

  it("parses the platform admin list", () => {
    expect([...platformAdminEmails(" A@x.cz, ,b@y.cz ")]).toEqual(["a@x.cz", "b@y.cz"]);
    expect(platformAdminEmails("").size).toBe(0);
  });

  it("trusts x-guest-ip only from the local proxy", () => {
    const req = { headers: { "x-guest-ip": "198.51.100.9" } };
    expect(visitorIp("127.0.0.1", req)).toBe("198.51.100.9");
    expect(visitorIp("203.0.113.7", req)).toBe("203.0.113.7");
  });
});
