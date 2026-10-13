import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { RoleAccessGuard, roleMayAccess, roleMayWrite } from "./role-access.guard";

function httpContext(method: string, originalUrl: string, role: string, permissions?: unknown): ExecutionContext {
  const req = { method, originalUrl, user: { role, permissions } };
  return { getType: () => "http", switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe("RoleAccessGuard", () => {
  const guard = new RoleAccessGuard();
  const noInvoices = { invoices: "none" };

  it("applies area permissions regardless of path case (Express routes ignore case)", () => {
    expect(() => guard.canActivate(httpContext("GET", "/api/v1/invoices/abc/pdf", "accountant", noInvoices))).toThrow();
    expect(() => guard.canActivate(httpContext("GET", "/api/v1/INVOICES/abc/pdf", "accountant", noInvoices))).toThrow();
    expect(() => guard.canActivate(httpContext("GET", "/API/V1/Invoices/abc?x=1", "accountant", noInvoices))).toThrow();
  });

  it("keeps admin routes closed to accountants in any case", () => {
    expect(() => guard.canActivate(httpContext("POST", "/api/v1/TEAM/invitations", "accountant"))).toThrow();
    expect(guard.canActivate(httpContext("POST", "/api/v1/TEAM/invitations", "admin"))).toBe(true);
  });
});

describe("roleMayWrite", () => {
  it("lets every role read", () => {
    for (const role of ["owner", "admin", "accountant", "viewer"]) {
      expect(roleMayWrite(role, "GET", "v1/tenants/me")).toBe(true);
    }
  });

  it("keeps viewers read-only except for their own account", () => {
    expect(roleMayWrite("viewer", "POST", "v1/invoices")).toBe(false);
    expect(roleMayWrite("viewer", "PATCH", "v1/contacts/123")).toBe(false);
    expect(roleMayWrite("viewer", "PATCH", "v1/me/profile")).toBe(true);
    expect(roleMayWrite("viewer", "PUT", "v1/dashboard/config")).toBe(true);
    expect(roleMayWrite("viewer", "POST", "v1/tenants")).toBe(true);
  });

  it("lets accountants work with documents but not administer the company", () => {
    expect(roleMayWrite("accountant", "POST", "v1/invoices/1/issue")).toBe(true);
    expect(roleMayWrite("accountant", "POST", "v1/bank-reconciliation/import")).toBe(true);
    expect(roleMayWrite("accountant", "PATCH", "v1/tenants/me")).toBe(false);
    expect(roleMayWrite("accountant", "POST", "v1/team/invitations")).toBe(false);
    expect(roleMayWrite("accountant", "POST", "v1/api-keys")).toBe(false);
    expect(roleMayWrite("accountant", "PUT", "v1/ai/settings")).toBe(false);
    // A linked chat creates invoices for the company: owner/admin only.
    expect(roleMayWrite("accountant", "POST", "v1/channel-links")).toBe(false);
    expect(roleMayWrite("viewer", "DELETE", "v1/channel-links/1")).toBe(false);
    expect(roleMayWrite("admin", "POST", "v1/channel-links")).toBe(true);
    // A prefix match is a whole path segment, not a substring.
    expect(roleMayWrite("accountant", "POST", "v1/teamwork")).toBe(true);
  });

  it("never limits owners, admins or API keys", () => {
    expect(roleMayWrite("admin", "DELETE", "v1/team/members/1")).toBe(true);
    expect(roleMayWrite("service", "POST", "v1/invoices")).toBe(true);
  });
});

describe("roleMayAccess with per-area permissions", () => {
  // "Fakturant": invoices + contacts, no expenses, bank read-only.
  const invoicer = { invoices: "write", contacts: "write", expenses: "none", bank: "read", reports: "none" };

  it("follows the member's level in each area", () => {
    expect(roleMayAccess("accountant", "POST", "v1/invoices", invoicer)).toBe(true);
    expect(roleMayAccess("accountant", "GET", "v1/expenses", invoicer)).toBe(false);
    expect(roleMayAccess("accountant", "POST", "v1/expenses", invoicer)).toBe(false);
    expect(roleMayAccess("accountant", "GET", "v1/bank-reconciliation/transactions", invoicer)).toBe(true);
    expect(roleMayAccess("accountant", "POST", "v1/bank-reconciliation/import", invoicer)).toBe(false);
    expect(roleMayAccess("accountant", "GET", "v1/exports/pohoda", invoicer)).toBe(false);
    expect(roleMayAccess("accountant", "POST", "v1/recurring-invoices", invoicer)).toBe(true);
  });

  it("lets a viewer be granted write access to one area", () => {
    expect(roleMayAccess("viewer", "POST", "v1/expenses", { expenses: "write" })).toBe(true);
    expect(roleMayAccess("viewer", "POST", "v1/invoices", { expenses: "write" })).toBe(false);
  });

  it("ignores overrides for admins and malformed overrides", () => {
    expect(roleMayAccess("admin", "POST", "v1/expenses", { expenses: "none" })).toBe(true);
    expect(roleMayAccess("accountant", "POST", "v1/expenses", { expenses: "bogus" })).toBe(true);
  });
});
