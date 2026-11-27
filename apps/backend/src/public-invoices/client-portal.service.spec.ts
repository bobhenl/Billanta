import { describe, expect, it, vi } from "vitest";
import { ClientPortalService } from "./client-portal.service";

vi.mock("../public-links/resolve", () => ({ resolvePortalToken: vi.fn(async () => "portal-token") }));

const portal = (customerName: string) => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([{ customer_name: customerName, company_name: "Dodavatel s.r.o.", profile_slug: null, link_prefix: null }])
    .mockResolvedValueOnce([]);
  return new ClientPortalService({ db: { execute } } as never);
};

describe("ClientPortalService customer name", () => {
  it("shows a readable name", async () => {
    await expect(portal("Odběratel a.s.").find("abc")).resolves.toMatchObject({ customerName: "Odběratel a.s." });
  });

  it("hides an encrypted name instead of showing its ciphertext (Důvěrný režim)", async () => {
    const view = await portal("enc:v1:AAAAAAAAAAAAAAAA:QQQQQQQQQQQQQQQQQQQQQQQQ").find("abc");
    expect(view.customerName).toBeNull();
    expect(JSON.stringify(view)).not.toContain("enc:v1:");
  });
});
