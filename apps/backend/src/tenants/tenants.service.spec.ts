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

describe("TenantsService.update tax office", () => {
  const actor = { userId: "u1", role: "owner" } as never;

  it("rejects a pracoviště of another office, also against the stored office", async () => {
    const service = new TenantsService();
    // 3004 Brno IV belongs to 461 (Jihomoravský kraj), not to 451 (Praha).
    await expect(service.update(dbReturning([{ id: "t1" }]), "t1", actor, { tax_office: 451, tax_workplace: 3004 })).rejects.toThrow(
      "tax_workplace_mismatch",
    );
    await expect(service.update(dbReturning([{ id: "t1", taxOffice: 451 }]), "t1", actor, { tax_workplace: 3004 })).rejects.toThrow(
      "tax_workplace_mismatch",
    );
  });

  it("accepts a pracoviště of the stored office", async () => {
    // The stub db has no update chain, so the call fails later; only the pair check matters here.
    const result = await new TenantsService()
      .update(dbReturning([{ id: "t1", taxOffice: 461 }]), "t1", actor, { tax_workplace: 3004 })
      .catch((e: Error) => e);
    expect(String(result instanceof Error ? result.message : "")).not.toContain("tax_workplace_mismatch");
  });

  it("rejects clearing the office while its pracoviště stays", async () => {
    await expect(
      new TenantsService().update(dbReturning([{ id: "t1", taxOffice: 461, taxWorkplace: 3004 }]), "t1", actor, { tax_office: null }),
    ).rejects.toThrow("tax_workplace_mismatch");
  });
});
