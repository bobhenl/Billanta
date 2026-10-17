import { describe, expect, it } from "vitest";
import { publicProfileOf, publicProfileSchema, withServiceIds } from "./public-profile";

describe("publicProfileSchema", () => {
  it("fills defaults for an empty object", () => {
    const p = publicProfileSchema.parse({});
    expect(p).toMatchObject({ enabled: false, slug: null, services: [], contactCta: true });
    expect(p.show).toEqual({ email: true, phone: false, website: true, address: true, ico: true, logo: true });
  });

  it("lowercases the slug and rejects bad or reserved ones", () => {
    expect(publicProfileSchema.parse({ slug: "Moje-Firma" }).slug).toBe("moje-firma");
    for (const slug of ["a", "-abc", "abc-", "ab_c", "www", "api", "x".repeat(41)]) {
      expect(publicProfileSchema.safeParse({ slug }).success, slug).toBe(false);
    }
  });

  it("requires a slug to publish", () => {
    expect(publicProfileSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(publicProfileSchema.safeParse({ enabled: true, slug: "novak" }).success).toBe(true);
  });

  it("turns blank texts into null and caps services", () => {
    const p = publicProfileSchema.parse({ tagline: "  ", services: [{ title: "Web", description: "", price: " " }] });
    expect(p.tagline).toBeNull();
    expect(p.services[0]).toEqual({ id: null, title: "Web", description: null, price: null, unitPrice: null, unit: null });
    expect(publicProfileSchema.safeParse({ services: Array.from({ length: 13 }, () => ({ title: "x" })) }).success).toBe(false);
  });

  it("keeps orders off by default and rounds unit prices", () => {
    const p = publicProfileSchema.parse({ services: [{ title: "Web", unitPrice: 1234.567, unit: " hod " }] });
    expect(p.orders).toEqual({ enabled: false, customItems: false, prepay: false });
    expect(p.contactForm).toBe(false);
    expect(p.services[0]).toMatchObject({ unitPrice: 1234.57, unit: "hod" });
    expect(publicProfileSchema.safeParse({ services: [{ title: "x", unitPrice: -1 }] }).success).toBe(false);
    expect(publicProfileSchema.safeParse({ services: [{ title: "x", id: "BAD id!" }] }).success).toBe(false);
  });
});

describe("withServiceIds", () => {
  it("keeps existing ids and gives new and duplicate ones a fresh id", () => {
    let n = 0;
    const p = publicProfileSchema.parse({ services: [{ title: "a", id: "aaaaaa" }, { title: "b" }, { title: "c", id: "aaaaaa" }] });
    const out = withServiceIds(p, () => `new${String(++n).padStart(3, "0")}`);
    expect(out.services.map((s) => s.id)).toEqual(["aaaaaa", "new001", "new002"]);
  });
});

describe("publicProfileOf", () => {
  it("is tolerant of garbage and unpublishes invalid stored data", () => {
    expect(publicProfileOf(null).enabled).toBe(false);
    expect(publicProfileOf({ enabled: true }).enabled).toBe(false);
    expect(publicProfileOf({ enabled: true, slug: "novak" })).toMatchObject({ enabled: true, slug: "novak" });
  });
});
