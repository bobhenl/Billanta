import { describe, expect, it } from "vitest";
import { brandCreditFor, brandCreditUrl, showsBrandCredit } from "./brand-credit";

const now = new Date("2026-10-19T12:00:00Z");
const free = {
  planEnforced: true,
  trialPlan: null,
  trialStartedAt: null,
  trialEndsAt: null,
  prepaidPlan: null,
  prepaidUntil: null,
  subscriptionPlan: null,
  subscriptionStatus: "none",
};
const optOut = { brandCredit: false };

describe("showsBrandCredit", () => {
  it("shows the line by default on every plan", () => {
    expect(showsBrandCredit({ ...free, invoiceFormPrefs: {} }, now)).toBe(true);
    expect(showsBrandCredit({ ...free, subscriptionPlan: "start", subscriptionStatus: "active", invoiceFormPrefs: null }, now)).toBe(true);
  });

  it("ignores the opt-out on the free plan", () => {
    expect(showsBrandCredit({ ...free, invoiceFormPrefs: optOut }, now)).toBe(true);
  });

  it("lets a paid plan, a running trial or a pre-limits company switch it off", () => {
    expect(showsBrandCredit({ ...free, subscriptionPlan: "start", subscriptionStatus: "active", invoiceFormPrefs: optOut }, now)).toBe(false);
    expect(showsBrandCredit({ ...free, prepaidPlan: "plus", prepaidUntil: "2026-12-31", invoiceFormPrefs: optOut }, now)).toBe(false);
    expect(showsBrandCredit({ ...free, trialPlan: "business", trialEndsAt: new Date("2026-10-25T00:00:00Z"), invoiceFormPrefs: optOut }, now)).toBe(false);
    expect(showsBrandCredit({ ...free, planEnforced: false, invoiceFormPrefs: optOut }, now)).toBe(false);
  });

  it("brings the line back when the plan lapses", () => {
    expect(showsBrandCredit({ ...free, trialPlan: "business", trialEndsAt: new Date("2026-10-01T00:00:00Z"), invoiceFormPrefs: optOut }, now)).toBe(true);
    expect(showsBrandCredit({ ...free, subscriptionPlan: "start", subscriptionStatus: "canceled", invoiceFormPrefs: optOut }, now)).toBe(true);
  });
});

describe("brandCreditUrl", () => {
  it("links the homepage with UTM tags and the referral code", () => {
    expect(brandCreditUrl("cs", "pdf", "ABC123", "https://billanta.com")).toBe(
      "https://billanta.com/cs?utm_source=invoice&utm_medium=footer&utm_content=pdf&ref=ABC123",
    );
  });

  it("leaves out a missing or malformed code", () => {
    expect(brandCreditUrl("en", "email", null, "https://x.test")).toBe("https://x.test/en?utm_source=invoice&utm_medium=footer&utm_content=email");
    expect(brandCreditUrl("sk", "page", "a b&c", "https://x.test")).not.toContain("ref=");
  });
});

describe("brandCreditFor", () => {
  it("returns the translated label or null", () => {
    expect(brandCreditFor({ ...free, referralCode: "ABCD" }, "sk", "page", now)?.label).toBe("Vystavené v aplikácii Billanta");
    expect(brandCreditFor({ ...free, subscriptionPlan: "plus", subscriptionStatus: "active", invoiceFormPrefs: optOut }, "cs", "pdf", now)).toBeNull();
  });
});
