import { describe, expect, it } from "vitest";
import { countryChange } from "./country-change";

describe("countryChange", () => {
  it("does nothing when the field is left out or unchanged", () => {
    expect(countryChange("CZ", undefined, true)).toBeNull();
    expect(countryChange("SK", "sk", true)).toBeNull();
  });

  it("switches an unlocked company and its home currency", () => {
    expect(countryChange("CZ", "SK", false)).toEqual({ country: "SK", homeCurrency: "EUR" });
    expect(countryChange("SK", "cz", false)).toEqual({ country: "CZ", homeCurrency: "CZK" });
  });

  it("refuses a change after the first issued invoice", () => {
    expect(() => countryChange("CZ", "SK", true)).toThrow("country_locked");
  });

  it("refuses a country that is not open yet", () => {
    expect(() => countryChange("CZ", "DE", false)).toThrow("country_not_supported");
  });
});
