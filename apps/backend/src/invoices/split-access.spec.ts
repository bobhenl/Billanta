import { describe, expect, it } from "vitest";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { DEFAULT_TAX_MODEL } from "../net-income/tax-model";
import { seesSplit, withoutSplit } from "./split-access";

const M = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const taxModel = {
  ...DEFAULT_TAX_MODEL,
  partners: [
    { id: "m", name: "M", share: 50, tax_credits: 30_840, user_id: M },
    { id: "r", name: "R", share: 50, tax_credits: 30_840, user_id: null },
  ],
};

/** A tenant DB whose tax model links the partner "m" to user M. */
const db = {
  select: () => {
    const q = {
      from: () => q,
      where: () => q,
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve([{ taxModel }]).then(ok),
    };
    return q;
  },
};
const req = (role: string, id: string, extra: Record<string, unknown> = {}) =>
  ({ tenantDb: db, user: { id, tenantId: "t1", role, ...extra } }) as unknown as TenantScopedRequest;

describe("seesSplit", () => {
  it("lets owners, admins and the members linked to a partner see the split", async () => {
    expect(await seesSplit(req("owner", "u-x"))).toBe(true);
    expect(await seesSplit(req("admin", "u-x"))).toBe(true);
    expect(await seesSplit(req("accountant", M))).toBe(true);
    expect(await seesSplit(req("viewer", M))).toBe(true);
  });

  it("hides it from other members and from API keys", async () => {
    expect(await seesSplit(req("accountant", OTHER))).toBe(false);
    expect(await seesSplit(req("service", M))).toBe(false);
    expect(await seesSplit(req("accountant", M, { apiKey: true }))).toBe(false);
  });
});

describe("withoutSplit", () => {
  it("keeps the split for who sees it and blanks it otherwise", () => {
    const row = { id: "i1", partnerShares: { r: 1 } };
    expect(withoutSplit(row, true)).toEqual(row);
    expect(withoutSplit(row, false)).toEqual({ id: "i1", partnerShares: null });
  });
});
