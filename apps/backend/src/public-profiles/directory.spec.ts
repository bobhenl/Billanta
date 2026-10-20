import { describe, expect, it } from "vitest";
import { publicProfileSchema } from "../tenants/public-profile";
import { filterDirectory, toDirectoryListing, type DirectoryRow } from "./directory";

const row = (over: Partial<DirectoryRow> = {}): DirectoryRow => ({
  slug: "novak",
  company_name: "Jan Novák",
  tagline: " Elektroinstalace ",
  trade: "tradesman",
  town: "brno",
  city: "Brno",
  country: "CZ",
  has_logo: false,
  ...over,
});

describe("directory opt-in in publicProfileSchema", () => {
  it("is off by default", () => {
    expect(publicProfileSchema.parse({}).directory).toEqual({ enabled: false, trade: null, town: null });
  });

  it("needs a trade and a town to list", () => {
    expect(publicProfileSchema.safeParse({ directory: { enabled: true } }).success).toBe(false);
    expect(publicProfileSchema.safeParse({ directory: { enabled: true, trade: "it" } }).success).toBe(false);
    expect(publicProfileSchema.parse({ directory: { enabled: true, trade: "it", town: " Praha " } }).directory).toEqual({ enabled: true, trade: "it", town: "praha" });
  });

  it("rejects unknown trades and malformed towns", () => {
    expect(publicProfileSchema.safeParse({ directory: { trade: "bakery" } }).success).toBe(false);
    expect(publicProfileSchema.safeParse({ directory: { town: "../etc" } }).success).toBe(false);
  });
});

describe("toDirectoryListing", () => {
  it("maps a row and trims texts", () => {
    expect(toDirectoryListing(row())).toEqual({
      slug: "novak", name: "Jan Novák", tagline: "Elektroinstalace", trade: "tradesman", town: "brno", city: "Brno", country: "CZ", hasLogo: false,
    });
  });

  it("drops rows with a bad slug, town or trade", () => {
    expect(toDirectoryListing(row({ slug: null }))).toBeNull();
    expect(toDirectoryListing(row({ town: "Brno!" }))).toBeNull();
    expect(toDirectoryListing(row({ trade: "bakery" }))).toBeNull();
  });
});

describe("filterDirectory", () => {
  const all = [row(), row({ slug: "it-praha", trade: "it", town: "praha" }), row({ slug: "it-brno", trade: "it" })].map((r) => toDirectoryListing(r)!);

  it("filters by trade, town or both", () => {
    expect(filterDirectory(all, {}).length).toBe(3);
    expect(filterDirectory(all, { trade: "it" }).map((l) => l.slug)).toEqual(["it-praha", "it-brno"]);
    expect(filterDirectory(all, { town: "BRNO" }).map((l) => l.slug)).toEqual(["novak", "it-brno"]);
    expect(filterDirectory(all, { trade: "it", town: "brno" }).map((l) => l.slug)).toEqual(["it-brno"]);
  });

  it("matches nothing for an unknown trade or town", () => {
    expect(filterDirectory(all, { trade: "bakery" })).toEqual([]);
    expect(filterDirectory(all, { town: "nowhere" })).toEqual([]);
    expect(filterDirectory(all, { town: "<script>" })).toEqual([]);
  });
});
