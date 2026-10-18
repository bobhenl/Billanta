import { describe, expect, it } from "vitest";
import { filterListings, saveListingSchema, type PublicListing } from "./listing";

const base = {
  displayName: "  Účetnictví   Novák ",
  regions: ["CZ-64"],
  services: ["vat", "bookkeeping", "vat"],
  languages: ["cs"],
  contactEmail: "Info@Novak.cz",
};

describe("saveListingSchema", () => {
  it("normalises names, order and duplicates", () => {
    const v = saveListingSchema.parse({ ...base, website: "novak.cz", priceHint: "  od 1 500 Kč / měsíc ", bio: "" });
    expect(v.displayName).toBe("Účetnictví Novák");
    expect(v.services).toEqual(["bookkeeping", "vat"]);
    expect(v.contactEmail).toBe("info@novak.cz");
    expect(v.website).toBe("https://novak.cz");
    expect(v.priceHint).toBe("od 1 500 Kč / měsíc");
    expect(v.bio).toBeNull();
  });

  it("needs a region or remote work", () => {
    expect(saveListingSchema.safeParse({ ...base, regions: [] }).success).toBe(false);
    expect(saveListingSchema.safeParse({ ...base, regions: [], remote: true }).success).toBe(true);
  });

  it("needs a way to make contact", () => {
    expect(saveListingSchema.safeParse({ ...base, contactEmail: "" }).success).toBe(false);
    expect(saveListingSchema.safeParse({ ...base, contactEmail: "", website: "https://novak.cz" }).success).toBe(true);
  });

  it("rejects unknown codes and odd websites", () => {
    expect(saveListingSchema.safeParse({ ...base, regions: ["CZ-99"] }).success).toBe(false);
    expect(saveListingSchema.safeParse({ ...base, services: ["crypto"] }).success).toBe(false);
    expect(saveListingSchema.safeParse({ ...base, website: "javascript:alert(1)" }).success).toBe(false);
    expect(saveListingSchema.safeParse({ ...base, website: "https://localhost" }).success).toBe(false);
  });
});

const listing = (over: Partial<PublicListing>): PublicListing => ({
  id: over.name ?? "x",
  name: "x",
  bio: null,
  regions: [],
  remote: false,
  services: ["bookkeeping"],
  languages: ["cs"],
  priceHint: null,
  contactEmail: "a@b.cz",
  website: null,
  profileSlug: null,
  ...over,
});

describe("filterListings", () => {
  const brno = listing({ name: "brno", regions: ["CZ-64"], services: ["vat"] });
  const praha = listing({ name: "praha", regions: ["CZ-10"] });
  const onlineCz = listing({ name: "online-cz", regions: ["CZ-10"], remote: true });
  const onlineAny = listing({ name: "online-any", remote: true });
  const bratislava = listing({ name: "ba", regions: ["SK-BL"], remote: true });
  const all = [brno, praha, onlineCz, onlineAny, bratislava];
  const names = (l: PublicListing[]) => l.map((x) => x.name);

  it("keeps everything without filters and ignores unknown codes", () => {
    expect(names(filterListings(all, {}))).toEqual(names(all));
    expect(names(filterListings(all, { region: "XX-1", service: "nope" }))).toEqual(names(all));
  });

  it("matches a region directly or through remote work in the same country", () => {
    expect(names(filterListings(all, { region: "CZ-64" }))).toEqual(["brno", "online-cz", "online-any"]);
    expect(names(filterListings(all, { region: "SK-KI" }))).toEqual(["online-any", "ba"]);
  });

  it("combines region and service", () => {
    expect(names(filterListings(all, { region: "CZ-64", service: "vat" }))).toEqual(["brno"]);
  });
});
