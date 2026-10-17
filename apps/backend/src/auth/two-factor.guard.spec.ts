import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { TwoFactorGuard } from "./two-factor.guard";

function contextFor(user: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe("TwoFactorGuard", () => {
  const guard = new TwoFactorGuard();

  it("lets a session that passed two-factor sign-in through", () => {
    expect(guard.canActivate(contextFor({ id: "u", tenantId: "t", role: "owner", twoFactor: true }))).toBe(true);
  });

  it.each([
    ["no 2FA on the session", { id: "u", tenantId: "t", role: "owner", twoFactor: false }],
    ["an API key", { id: "k", tenantId: "t", role: "service" }],
    ["no user at all", undefined],
  ])("refuses %s with two_factor_required", (_label, user) => {
    expect(() => guard.canActivate(contextFor(user))).toThrow(new ForbiddenException("two_factor_required"));
  });
});
