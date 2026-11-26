import { describe, expect, it } from "vitest";
import { peppolRelevant } from "./peppol-relevance";

const buyer = { addressCountry: "DE", isPerson: false, ico: null, dic: "DE123456789" };

describe("peppolRelevant", () => {
  it("checks a foreign company with an id and any Slovak company", () => {
    expect(peppolRelevant(buyer)).toBe(true);
    expect(peppolRelevant({ ...buyer, dic: null, ico: "12345678" })).toBe(true);
    expect(peppolRelevant({ ...buyer, addressCountry: "SK", dic: null })).toBe(true);
  });

  it("skips Czech buyers, consumers and foreign buyers with no company id", () => {
    expect(peppolRelevant({ ...buyer, addressCountry: "CZ" })).toBe(false);
    expect(peppolRelevant({ ...buyer, isPerson: true })).toBe(false);
    expect(peppolRelevant({ ...buyer, addressCountry: "GB", dic: " " })).toBe(false);
  });
});
