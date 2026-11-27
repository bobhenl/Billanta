import { describe, expect, it } from "vitest";
import { updateTenantSchema } from "./dto/update-tenant.dto";
import { secondaryPeriodFields, TenantsService } from "./tenants.service";

/** A select chain that resolves to the given rows, like drizzle's `select().from().where().limit()`. */
function dbReturning(rows: Record<string, unknown>[]) {
  const chain = { from: () => chain, where: () => chain, limit: async () => rows };
  return { select: () => chain, execute: async () => [{ locked: false }] } as never;
}

describe("TenantsService.findById", () => {
  it("never returns the encrypted AI or Stripe key, only whether one is set", async () => {
    const [tenant] = await new TenantsService().findById(
      dbReturning([{ id: "t1", companyName: "Firma", aiApiKeyEncrypted: "iv:tag:ai", stripeSecretKeyEncrypted: "iv:tag:sk", logoData: null, taxAdvances: null }]),
      "t1",
    );
    expect(tenant).not.toHaveProperty("aiApiKeyEncrypted");
    expect(tenant).not.toHaveProperty("stripeSecretKeyEncrypted");
    expect(JSON.stringify(tenant)).not.toContain("iv:tag");
    expect(tenant).toMatchObject({ companyName: "Firma", hasStripeKey: true, hasLogo: false });
  });

  it("leaves out the tax model, which only owners and admins read", async () => {
    const [tenant] = await new TenantsService().findById(
      dbReturning([{ id: "t1", companyName: "Firma", logoData: null, taxModel: { partners: [{ name: "Partner A", credit: 30840 }] } }]),
      "t1",
    );
    expect(tenant).not.toHaveProperty("taxModel");
    expect(JSON.stringify(tenant)).not.toContain("Partner A");
  });

  it("says no Stripe key when none is stored", async () => {
    const [tenant] = await new TenantsService().findById(dbReturning([{ id: "t1", stripeSecretKeyEncrypted: null, logoData: null }]), "t1");
    expect(tenant).toMatchObject({ hasStripeKey: false });
  });
});

describe("secondaryPeriodFields", () => {
  const stored = { secondaryActivityFrom: "2026-01-01", secondaryActivityTo: "2026-06-30" };

  it("writes only the days the patch sends", () => {
    expect(secondaryPeriodFields({}, stored)).toEqual({});
    expect(secondaryPeriodFields({ secondary_activity_to: null }, stored)).toEqual({ secondaryActivityTo: null });
    expect(secondaryPeriodFields({ secondary_activity_from: "2026-03-01", secondary_activity_to: "2026-03-01" }, undefined)).toEqual({
      secondaryActivityFrom: "2026-03-01",
      secondaryActivityTo: "2026-03-01",
    });
  });

  it("refuses a period that ends before it starts, also against the stored day", () => {
    expect(() => secondaryPeriodFields({ secondary_activity_from: "2026-07-01", secondary_activity_to: "2026-06-30" }, undefined)).toThrow("secondary_activity_period_invalid");
    expect(() => secondaryPeriodFields({ secondary_activity_from: "2026-07-01" }, stored)).toThrow("secondary_activity_period_invalid");
    expect(() => secondaryPeriodFields({ secondary_activity_to: "2025-12-31" }, stored)).toThrow("secondary_activity_period_invalid");
  });
});

describe("updateTenantSchema – secondary activity days", () => {
  const parse = (d: unknown) => updateTenantSchema.safeParse({ secondary_activity_from: d }).success;

  it("takes a real calendar day or null, nothing else", () => {
    expect(parse("2028-02-29")).toBe(true);
    expect(parse(null)).toBe(true);
    expect(parse("2026-02-30")).toBe(false);
    expect(parse("2026-13-01")).toBe(false);
    expect(parse("2026-6-1")).toBe(false);
  });
});
