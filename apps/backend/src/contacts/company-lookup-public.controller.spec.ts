import type { VatPayerCheck } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { toPublicVatCheck } from "./company-lookup-public.controller";

const adis: VatPayerCheck = {
  vatId: "CZ27082440",
  state: "payer",
  source: "ADIS",
  name: "Alza.cz a.s.",
  bankAccounts: ["2047300106/2600", "19-123457/0100"],
};

describe("toPublicVatCheck", () => {
  it("never hands the published accounts to an anonymous visitor, only their count", () => {
    const out = toPublicVatCheck(adis);
    expect(out).toEqual({ vatId: "CZ27082440", state: "payer", source: "ADIS", name: "Alza.cz a.s.", accounts: { published: 2, match: null } });
    expect(JSON.stringify(out)).not.toContain("2047300106");
  });

  it("says whether the asked account is published", () => {
    expect(toPublicVatCheck(adis, " 19-0000123457/0100 ").accounts).toEqual({ published: 2, match: true });
    expect(toPublicVatCheck(adis, "123/0300").accounts).toEqual({ published: 2, match: false });
    expect(toPublicVatCheck(adis, "nonsense").accounts).toEqual({ published: 2, match: null });
  });

  it("has no account info outside the CZ register", () => {
    const vies: VatPayerCheck = { vatId: "SK2020317068", state: "valid", source: "VIES", name: "X s.r.o.", bankAccounts: [] };
    expect(toPublicVatCheck(vies, "2047300106/2600").accounts).toBeNull();
  });
});
