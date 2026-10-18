import { describe, expect, it } from "vitest";
import { TenantsService } from "./tenants.service";

/** A select chain that resolves to the given rows, like drizzle's `select().from().where().limit()`. */
function dbReturning(rows: Record<string, unknown>[]) {
  const chain = { from: () => chain, where: () => chain, limit: async () => rows };
  return { select: () => chain } as never;
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

  it("says no Stripe key when none is stored", async () => {
    const [tenant] = await new TenantsService().findById(dbReturning([{ id: "t1", stripeSecretKeyEncrypted: null, logoData: null }]), "t1");
    expect(tenant).toMatchObject({ hasStripeKey: false });
  });
});
