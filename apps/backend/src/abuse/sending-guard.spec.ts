import { describe, expect, it } from "vitest";
import { SENDING_CAPS, dailyCapFor, sendingBlock } from "./sending-guard";

const now = new Date("2026-10-04T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const tenant = (over: Partial<Parameters<typeof sendingBlock>[0]> = {}) => ({
  createdAt: daysAgo(30),
  subscriptionStatus: "trialing",
  suspendedAt: null,
  emailPausedAt: null,
  ...over,
});

describe("sending guard", () => {
  it("gives new accounts the low cap, paid ones the high cap", () => {
    expect(dailyCapFor(tenant({ createdAt: daysAgo(2) }), now)).toBe(SENDING_CAPS.newAccount);
    expect(dailyCapFor(tenant({ createdAt: daysAgo(2), subscriptionStatus: "active" }), now)).toBe(SENDING_CAPS.newAccount);
    expect(dailyCapFor(tenant(), now)).toBe(SENDING_CAPS.trial);
    expect(dailyCapFor(tenant({ subscriptionStatus: "active" }), now)).toBe(SENDING_CAPS.paid);
  });

  it("blocks suspended and paused companies before looking at the cap", () => {
    expect(sendingBlock(tenant({ suspendedAt: now, emailPausedAt: now }), 0, now)).toBe("ACCOUNT_SUSPENDED");
    expect(sendingBlock(tenant({ emailPausedAt: now }), 0, now)).toBe("EMAIL_PAUSED");
  });

  it("blocks once today's cap is used up", () => {
    expect(sendingBlock(tenant(), SENDING_CAPS.trial - 1, now)).toBeNull();
    expect(sendingBlock(tenant(), SENDING_CAPS.trial, now)).toBe("EMAIL_DAILY_LIMIT");
  });
});
