import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { DEFAULT_TAX_MODEL } from "../net-income/tax-model";
import { linkedPartnerMay } from "./linked-partner";
import { RoleAccessGuard } from "./role-access.guard";

const M = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";

const model = {
  ...DEFAULT_TAX_MODEL,
  partners: [
    { id: "m", name: "M", share: 50, tax_credits: 30_840, user_id: M },
    { id: "r", name: "R", share: 50, tax_credits: 30_840, user_id: null },
  ],
};

/** Just the select the guard makes on `tenants`; counts lookups so tests see when none was needed. */
function fakeDb(taxModel: unknown) {
  const calls = { n: 0 };
  const db = { select: () => ({ from: () => ({ where: async () => (calls.n++, [{ taxModel }]) }) }) };
  return { db, calls };
}

function run(method: string, url: string, role: string, userId: string, db: unknown, permissions?: unknown): Promise<boolean> {
  const req = { method, originalUrl: url, tenantDb: db, user: { id: userId, tenantId: TENANT, role, permissions } };
  const ctx = { getType: () => "http", switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return Promise.resolve().then(() => new RoleAccessGuard().canActivate(ctx));
}

describe("linked partner access to Po zdanění", () => {
  it("lets an accountant linked to a partner read the report, its inputs and the tax model", async () => {
    const { db } = fakeDb(model);
    await expect(run("GET", "/api/v1/net-income?year=2026", "accountant", M, db)).resolves.toBe(true);
    await expect(run("GET", "/api/v1/net-income/inputs?year=2026", "accountant", M, db)).resolves.toBe(true);
    await expect(run("GET", "/api/v1/tenants/me/tax-model", "accountant", M, db)).resolves.toBe(true);
    await expect(run("GET", "/api/v1/net-income?year=2026", "viewer", M, db)).resolves.toBe(true);
  });

  it("keeps changing the tax model with owners and admins, even for a linked partner", async () => {
    const { db, calls } = fakeDb(model);
    await expect(run("PUT", "/api/v1/tenants/me/tax-model", "accountant", M, db)).rejects.toThrow();
    await expect(run("PATCH", "/api/v1/tenants/me/tax-model", "accountant", M, db)).rejects.toThrow();
    await expect(run("PATCH", "/api/v1/invoices/abc/lock", "accountant", M, db)).rejects.toThrow();
    expect(calls.n).toBe(0);
  });

  it("refuses members who are not linked, and companies without a stored model", async () => {
    await expect(run("GET", "/api/v1/net-income?year=2026", "accountant", OTHER, fakeDb(model).db)).rejects.toThrow();
    await expect(run("GET", "/api/v1/tenants/me/tax-model", "accountant", OTHER, fakeDb(model).db)).rejects.toThrow();
    await expect(run("GET", "/api/v1/net-income/inputs", "viewer", OTHER, fakeDb(model).db)).rejects.toThrow();
    await expect(run("GET", "/api/v1/net-income", "accountant", M, fakeDb(null).db)).rejects.toThrow();
    await expect(run("GET", "/api/v1/net-income", "accountant", M, undefined)).rejects.toThrow();
  });

  it("lets a linked partner split an invoice only with the invoice permission to edit it", async () => {
    await expect(run("PUT", "/api/v1/invoices/abc/partner-shares", "accountant", M, fakeDb(model).db)).resolves.toBe(true);
    await expect(run("PUT", "/api/v1/invoices/abc/partner-shares", "accountant", M, fakeDb(model).db, { invoices: "read" })).rejects.toThrow();
    await expect(run("PUT", "/api/v1/invoices/abc/partner-shares", "viewer", M, fakeDb(model).db)).rejects.toThrow();
    await expect(run("PUT", "/api/v1/invoices/abc/partner-shares", "accountant", OTHER, fakeDb(model).db)).rejects.toThrow();
  });

  it("leaves owners and admins as they were, without a lookup", async () => {
    const { db, calls } = fakeDb(model);
    for (const role of ["owner", "admin"]) {
      await expect(run("GET", "/api/v1/net-income", role, OTHER, db)).resolves.toBe(true);
      await expect(run("PUT", "/api/v1/tenants/me/tax-model", role, OTHER, db)).resolves.toBe(true);
    }
    expect(calls.n).toBe(0);
  });
});

describe("linkedPartnerMay", () => {
  it("names only the partner routes and only human non-admin roles", () => {
    expect(linkedPartnerMay("accountant", "GET", "v1/net-income")).toBe(true);
    expect(linkedPartnerMay("accountant", "GET", "v1/net-incomes")).toBe(false);
    expect(linkedPartnerMay("accountant", "GET", "v1/tenants/me/tax-model/x")).toBe(false);
    expect(linkedPartnerMay("accountant", "DELETE", "v1/invoices/abc/partner-shares")).toBe(false);
    expect(linkedPartnerMay("service", "GET", "v1/net-income")).toBe(false);
    expect(linkedPartnerMay("unknown", "GET", "v1/net-income")).toBe(false);
  });
});
