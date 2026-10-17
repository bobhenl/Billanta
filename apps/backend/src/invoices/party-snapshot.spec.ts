import { describe, expect, it } from "vitest";
import {
  applyBuyerSnapshot,
  applySellerSnapshot,
  buyerSnapshotFromImport,
  buyerSnapshotOf,
  documentParties,
  SELLER_SNAPSHOT_KEYS,
  sellerSnapshotOf,
  snapshotDiffers,
} from "./party-snapshot";

const tenant = {
  id: "t1",
  companyName: "Nová Firma",
  legalName: "Nová Firma s.r.o.",
  ico: "87654321",
  dic: "CZ87654321",
  dicVatPayer: true,
  addressStreet: "Nová 2",
  addressCity: "Brno",
  addressPostalCode: "602 00",
  addressCountry: "CZ",
  registryNote: "C 999 KS Brno",
  email: "nova@firma.cz",
  phone: null,
  website: null,
  bankAccountNumber: "222",
  bankAccountBankCode: "0800",
  bankAccountIban: null,
  bankAccountSwift: null,
  logoDataUrl: "data:image/png;base64,AAA",
};
const contact = {
  id: "c1",
  legalName: "Odběratel Nový",
  ico: "11111111",
  dic: null,
  isVatPayer: false,
  isPerson: false,
  email: "new@buyer.cz",
  addressStreet: "Jiná 5",
  addressCity: "Ostrava",
  addressPostalCode: "700 30",
  addressCountry: "CZ",
  portalToken: "p",
};

describe("party snapshot", () => {
  it("captures every printed field (and not the logo)", () => {
    const at = new Date("2026-01-02T03:04:05Z");
    const s = sellerSnapshotOf(tenant as never, at);
    for (const key of SELLER_SNAPSHOT_KEYS) expect(s).toHaveProperty(key, (tenant as Record<string, unknown>)[key]);
    expect(s).not.toHaveProperty("logoDataUrl");
    expect(s).toMatchObject({ capturedAt: "2026-01-02T03:04:05.000Z", source: "issue" });
    expect(buyerSnapshotOf(contact as never, at)).toMatchObject({ legalName: "Odběratel Nový", ico: "11111111", email: "new@buyer.cz", isVatPayer: false });
  });

  it("falls back to the live rows without a snapshot", () => {
    const parties = documentParties({ sellerSnapshot: null, buyerSnapshot: null }, tenant, contact);
    expect(parties.tenant).toBe(tenant);
    expect(parties.contact).toBe(contact);
    expect(documentParties({ sellerSnapshot: { dic: "CZ1" }, buyerSnapshot: null }, tenant, null).contact).toBeNull();
  });

  it("lays the snapshot over the live rows, a stored null included", () => {
    const parties = documentParties(
      {
        sellerSnapshot: { legalName: "Stará Firma s.r.o.", dic: null, addressStreet: "Stará 1", bankAccountNumber: "111" },
        buyerSnapshot: { legalName: "Odběratel Starý", addressStreet: "info@buyer.cz" },
      },
      tenant,
      contact,
    );
    expect(parties.tenant).toMatchObject({ legalName: "Stará Firma s.r.o.", dic: null, addressStreet: "Stará 1", bankAccountNumber: "111", addressCity: "Brno" });
    expect(parties.tenant.logoDataUrl).toBe(tenant.logoDataUrl);
    expect(parties.contact).toMatchObject({ legalName: "Odběratel Starý", addressStreet: "info@buyer.cz", ico: "11111111", portalToken: "p" });
  });

  it("ignores malformed snapshot values", () => {
    expect(applySellerSnapshot(tenant, { legalName: "", addressCountry: null, dicVatPayer: "yes", ico: 5 })).toBe(tenant);
    expect(applySellerSnapshot(tenant, [1, 2])).toBe(tenant);
    expect(applyBuyerSnapshot(contact, { isVatPayer: null }).isVatPayer).toBeNull();
  });

  it("tells whether the document's details differ from the current ones", () => {
    expect(snapshotDiffers(null, tenant, SELLER_SNAPSHOT_KEYS)).toBe(false);
    expect(snapshotDiffers(sellerSnapshotOf(tenant as never), tenant, SELLER_SNAPSHOT_KEYS)).toBe(false);
    expect(snapshotDiffers({ dic: "CZ12345678" }, tenant, SELLER_SNAPSHOT_KEYS)).toBe(true);
  });

  it("builds an import snapshot from present fields only", () => {
    expect(buyerSnapshotFromImport({ legalName: "" })).toBeNull();
    const s = buyerSnapshotFromImport({ legalName: "Acme", addressStreet: "a@b.cz" }, new Date("2026-01-01T00:00:00Z"));
    expect(s).toEqual({ legalName: "Acme", addressStreet: "a@b.cz", capturedAt: "2026-01-01T00:00:00.000Z", source: "import" });
  });
});
