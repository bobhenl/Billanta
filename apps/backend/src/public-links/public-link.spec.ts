import { describe, expect, it, vi } from "vitest";
import {
  buyerDetailsLinkOf,
  clientPortalLinkOf,
  documentPrefix,
  invoiceLinkOf,
  newShortKey,
  parseLinkSegment,
  publicLinkPrefixOf,
  slugify,
} from "./public-link";
import { resolveInvoiceToken, resolvePortalToken } from "./resolve";

const KEY = "k3Fq9Xa2Lm7P";
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("slugify", () => {
  it("strips diacritics and keeps a-z, 0-9 and single dashes", () => {
    expect(slugify("Žluťoučký kůň s.r.o.")).toBe("zlutoucky-kun-s-r-o");
    expect(slugify("FV/2026/0012")).toBe("fv-2026-0012");
    expect(slugify("  --Ďábel & syn--  ")).toBe("dabel-syn");
  });

  it("caps the length without leaving a trailing dash", () => {
    expect(slugify("a".repeat(60))).toHaveLength(40);
    expect(slugify("abcd efgh", 5)).toBe("abcd");
  });

  it("is empty for nothing usable", () => {
    expect(slugify(null)).toBe("");
    expect(slugify("")).toBe("");
    expect(slugify("§§§")).toBe("");
  });
});

describe("documentPrefix", () => {
  it("uses the number, the company plus the number, or nothing", () => {
    expect(documentPrefix("number", "2026-0012", "vejtom")).toBe("2026-0012");
    expect(documentPrefix("company_number", "2026-0012", "vejtom")).toBe("vejtom-2026-0012");
    expect(documentPrefix("none", "2026-0012", "vejtom")).toBe("");
  });

  it("handles a missing number (drafts) and gives the company only the room left", () => {
    expect(documentPrefix("number", null, "vejtom")).toBe("");
    expect(documentPrefix("company_number", "", "vejtom")).toBe("vejtom");
    const long = documentPrefix("company_number", "2026-0012", "a-very-long-company-name-that-keeps-going");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-2026-0012")).toBe(true);
  });

  it("defaults the stored setting to the number", () => {
    expect(publicLinkPrefixOf(undefined)).toBe("number");
    expect(publicLinkPrefixOf({ publicLinkPrefix: "bogus" })).toBe("number");
    expect(publicLinkPrefixOf({ publicLinkPrefix: "none" })).toBe("none");
  });
});

describe("link builders", () => {
  const tenant = { companyName: "Vejtom s.r.o.", publicProfile: {}, invoiceFormPrefs: { publicLinkPrefix: "company_number" } };

  it("builds /i/ from the prefix and the key, the profile slug winning over the name", () => {
    expect(invoiceLinkOf(tenant, { publicKey: KEY, publicToken: UUID, invoiceNumber: "2026-0012" })).toBe(`vejtom-s-r-o-2026-0012-${KEY}`);
    expect(invoiceLinkOf({ ...tenant, publicProfile: { slug: "vejtom" } }, { publicKey: KEY, publicToken: UUID, invoiceNumber: "2026-0012" })).toBe(
      `vejtom-2026-0012-${KEY}`,
    );
    expect(invoiceLinkOf(undefined, { publicKey: KEY, publicToken: UUID, invoiceNumber: null })).toBe(KEY);
  });

  it("falls back to the UUID for a row without a key", () => {
    expect(invoiceLinkOf(tenant, { publicKey: null, publicToken: UUID, invoiceNumber: "2026-0012" })).toBe(UUID);
  });

  it("puts the customer's name in front of /c/, nothing with 'none', null when the portal is off", () => {
    expect(clientPortalLinkOf(tenant, { portalKey: KEY, portalToken: UUID, legalName: "Novák a syn" })).toBe(`novak-a-syn-${KEY}`);
    expect(clientPortalLinkOf({ invoiceFormPrefs: { publicLinkPrefix: "none" } }, { portalKey: KEY, portalToken: UUID, legalName: "Novák" })).toBe(KEY);
    expect(clientPortalLinkOf(tenant, { portalKey: null, portalToken: UUID, legalName: "Novák" })).toBe(UUID);
    expect(clientPortalLinkOf(tenant, { portalKey: KEY, portalToken: null, legalName: "Novák" })).toBeNull();
  });

  it("keeps an old UUID buyer-details token bare", () => {
    expect(buyerDetailsLinkOf(tenant, { invoiceNumber: "2026-0012" }, KEY)).toBe(`vejtom-s-r-o-2026-0012-${KEY}`);
    expect(buyerDetailsLinkOf(tenant, { invoiceNumber: "2026-0012" }, UUID)).toBe(UUID);
  });
});

describe("parseLinkSegment", () => {
  it("takes only the key after the last dash, whatever the prefix", () => {
    expect(parseLinkSegment(`vejtom-2026-0012-${KEY}`)).toEqual({ kind: "key", value: KEY });
    expect(parseLinkSegment(`wrong-prefix-${KEY}`)).toEqual({ kind: "key", value: KEY });
    expect(parseLinkSegment(KEY)).toEqual({ kind: "key", value: KEY });
  });

  it("reads a whole UUID as a legacy token, lower-cased", () => {
    expect(parseLinkSegment(UUID)).toEqual({ kind: "uuid", value: UUID });
    expect(parseLinkSegment(UUID.toUpperCase())).toEqual({ kind: "uuid", value: UUID });
  });

  it("rejects what can't be a link", () => {
    expect(parseLinkSegment("2026-0012")).toBeNull(); // a number alone is no key
    expect(parseLinkSegment(`${KEY}x`)).toBeNull();
    expect(parseLinkSegment(`bad prefix-${KEY}`)).toBeNull();
    expect(parseLinkSegment(`a/../b-${KEY}`)).toBeNull();
    expect(parseLinkSegment(`${"a".repeat(120)}-${KEY}`)).toBeNull();
    expect(parseLinkSegment("")).toBeNull();
  });
});

describe("newShortKey", () => {
  it("makes 12 base62 characters that parse back as a key", () => {
    const key = newShortKey();
    expect(key).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(parseLinkSegment(`2026-0012-${key}`)).toEqual({ kind: "key", value: key });
  });

  it("skips bytes >= 248 so % 62 has no bias", () => {
    const bytes = [255, 248, ...Array.from({ length: 14 }, (_, i) => i)];
    expect(newShortKey(() => Buffer.from(bytes))).toBe("0123456789AB");
  });
});

describe("resolving a link to the uuid token", () => {
  const fakeDb = (token: string | null) => ({ execute: vi.fn().mockResolvedValue([{ token }]) });

  it("passes an old UUID link straight through, without a query", async () => {
    const db = fakeDb("unused");
    expect(await resolveInvoiceToken(db as never, UUID.toUpperCase())).toBe(UUID);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("looks a key up and ignores the prefix", async () => {
    const db = fakeDb(UUID);
    expect(await resolveInvoiceToken(db as never, `wrong-${KEY}`)).toBe(UUID);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.execute.mock.calls[0][0])).toContain(KEY);
    expect(JSON.stringify(db.execute.mock.calls[0][0])).not.toContain("wrong");
  });

  it("returns null for an unknown key and never queries a malformed segment", async () => {
    expect(await resolvePortalToken(fakeDb(null) as never, `novak-${KEY}`)).toBeNull();
    const db = fakeDb(UUID);
    expect(await resolvePortalToken(db as never, "not a link")).toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });
});
