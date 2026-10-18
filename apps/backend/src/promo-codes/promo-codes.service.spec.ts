import { describe, expect, it } from "vitest";
import type { PromoCodeRow } from "./promo-kind-handler";
import { PromoCodesService, promoCodeSchema, publicPromoView, updatePromoCodeSchema } from "./promo-codes.service";

const row: PromoCodeRow = {
  id: "00000000-0000-0000-0000-000000000001",
  code: "KAVARNA-BRNO",
  kind: "event",
  benefitType: "free_months",
  benefitPlan: "plus",
  benefitValue: 3,
  maxRedemptions: 50,
  redemptionCount: 7,
  validFrom: null,
  validUntil: "2026-12-31",
  active: true,
  ownerLabel: "Kavárna Brno",
  note: "internal deal",
  referralCode: "ABCD2345",
  businessPreset: "flatTax",
  defaultLocale: "cs",
  createdBy: "staff@example.com",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("publicPromoView", () => {
  it("keeps the referrer, the note and the counts off the public join page", () => {
    const view = publicPromoView(row);
    expect(view).toEqual({
      code: "KAVARNA-BRNO",
      kind: "event",
      ownerLabel: "Kavárna Brno",
      benefitType: "free_months",
      benefitPlan: "plus",
      benefitValue: 3,
      businessPreset: "flatTax",
      defaultLocale: "cs",
    });
  });
});

describe("promoCodeSchema join fields", () => {
  const base = { code: "kavarna-brno", kind: "event", benefit_type: "trial_days", benefit_plan: "plus", benefit_value: 30 };

  it("upper-cases the passphrase and the referrer code", () => {
    const parsed = promoCodeSchema.parse({ ...base, referral_code: " abcd2345 ", business_preset: "eshop", default_locale: "sk" });
    expect(parsed.code).toBe("KAVARNA-BRNO");
    expect(parsed.referral_code).toBe("ABCD2345");
    expect(parsed.business_preset).toBe("eshop");
  });

  it("treats an empty referrer as none and refuses unknown presets and locales", () => {
    expect(promoCodeSchema.parse({ ...base, referral_code: "" }).referral_code).toBe("");
    expect(promoCodeSchema.safeParse({ ...base, business_preset: "bakery" }).success).toBe(false);
    expect(promoCodeSchema.safeParse({ ...base, default_locale: "de" }).success).toBe(false);
    expect(promoCodeSchema.safeParse({ ...base, referral_code: "not a code!" }).success).toBe(false);
  });

  it("lets staff clear the join extras on an issued code", () => {
    expect(updatePromoCodeSchema.parse({ business_preset: null, default_locale: null })).toEqual({ business_preset: null, default_locale: null });
  });
});

describe("registerKindHandler", () => {
  it("allows one handler per kind", () => {
    const service = new PromoCodesService({} as never, {} as never);
    const handler = { onRedeem: async () => {} };
    service.registerKindHandler("class", handler);
    expect(() => service.registerKindHandler("class", handler)).toThrow(/already/);
  });
});
