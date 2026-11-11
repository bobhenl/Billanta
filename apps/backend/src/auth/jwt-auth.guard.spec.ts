import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import { describe, expect, it } from "vitest";
import { aiServiceMayCall, type AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import { JwtAuthGuard } from "./jwt-auth.guard";

const ctx = (req: object) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;
const guard = new JwtAuthGuard({} as JwtService);
const base: AuthenticatedUser = { id: "u", tenantId: "t", role: "owner" };

describe("JwtAuthGuard", () => {
  it("passes a user the tenant middleware already resolved", () => {
    expect(guard.canActivate(ctx({ headers: {}, user: base }))).toBe(true);
  });

  it("refuses an API key on a dashboard-only route", () => {
    const req = { headers: {}, user: { ...base, role: "service", apiKey: true } };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });
});

describe("aiServiceMayCall", () => {
  it("allows only the routes the AI service uses", () => {
    expect(aiServiceMayCall("POST", "/api/v1/invoices/drafts")).toBe(true);
    expect(aiServiceMayCall("post", "/api/v1/contacts/ares-lookup?x=1")).toBe(true);
    expect(aiServiceMayCall("GET", "/api/v1/exports/invoices.csv")).toBe(false);
    expect(aiServiceMayCall("POST", "/api/v1/invoices/123/issue")).toBe(false);
    expect(aiServiceMayCall("GET", "/api/v1/invoices/drafts")).toBe(false);
  });
});
