import { describe, expect, it } from "vitest";
import { belongsToPartner } from "./partner-filter";

const partners = [
  { id: "m", name: "Martin", share: 2, tax_credits: 0 },
  { id: "r", name: "Radka", share: 1, tax_credits: 0 },
  { id: "d", name: "Dan", share: 0, tax_credits: 0 },
];
const inv = (partnerShares: unknown, documentType = "invoice") => ({ documentType, partnerShares });

describe("belongsToPartner", () => {
  it("uses the invoice's own split when it has one", () => {
    expect(belongsToPartner(inv({ d: 1 }), partners, "d")).toBe(true);
    expect(belongsToPartner(inv({ d: 1 }), partners, "m")).toBe(false);
  });

  it("falls back to the default shares for no split", () => {
    expect(belongsToPartner(inv(null), partners, "m")).toBe(true);
    expect(belongsToPartner(inv(null), partners, "d")).toBe(false);
  });

  it("treats a zero weight in the own split as not belonging", () => {
    expect(belongsToPartner(inv({ m: 0, r: 3 }), partners, "m")).toBe(false);
    expect(belongsToPartner(inv({ m: 0, r: 3 }), partners, "r")).toBe(true);
  });

  it("reads a split that no longer parses as the defaults", () => {
    expect(belongsToPartner(inv({ m: 0, r: 0 }), partners, "m")).toBe(true);
    expect(belongsToPartner(inv({ m: 0, r: 0 }), partners, "d")).toBe(false);
  });

  it("knows nothing of an unknown partner", () => {
    expect(belongsToPartner(inv(null), partners, "x")).toBe(false);
  });

  it("matches credit notes but not proformas or quotes", () => {
    expect(belongsToPartner(inv(null, "credit_note"), partners, "m")).toBe(true);
    expect(belongsToPartner(inv(null, "proforma"), partners, "m")).toBe(false);
    expect(belongsToPartner(inv({ m: 1 }, "quote"), partners, "m")).toBe(false);
  });
});
