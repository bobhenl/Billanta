import { describe, expect, it } from "vitest";
import { platformAdminEmails } from "../partners/platform-admin.guard";
import { partnerSchema } from "../partners/partners.service";
import { visitorIp } from "../guest-invoices/guest-limits";
import { planCost, REFERRAL_REWARDS } from "./rewards";

describe("planCost", () => {
  it("charges a month at the monthly price and a year at the yearly rate", () => {
    expect(planCost("start", 1)).toBe(149);
    expect(planCost("plus", 12)).toBe(239 * 12);
  });

  it("pays the inviter more than the welcome bonus, and the accountant more than a friend", () => {
    expect(REFERRAL_REWARDS.friend.reward).toBeGreaterThan(REFERRAL_REWARDS.friend.welcome);
    expect(REFERRAL_REWARDS.accountant.reward).toBeGreaterThan(REFERRAL_REWARDS.friend.reward);
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
