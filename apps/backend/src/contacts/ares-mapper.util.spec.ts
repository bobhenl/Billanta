import type { AresSubject, RuzSubject } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { mapAresSubjectToContactPrefill, mapRpoSubjectToContactPrefill, mapRuzSubjectToContactPrefill, withRuzDic } from "./ares-mapper.util";

const RUZ: RuzSubject = {
  ico: "35763469",
  dic: "2020273893",
  name: "Slovak Telekom, a.s.",
  street: "Bajkalská 28",
  city: "Bratislava",
  postalCode: "81762",
  legalForm: "121",
  terminatedAt: null,
  updatedAt: "2026-07-03",
};
const RPO = { ico: "35763469", name: "Slovak Telekom, a.s.", street: "Bajkalská 2", city: "Bratislava", postalCode: "81762", terminatedAt: null };

describe("Slovak prefills", () => {
  it("maps an RÚZ unit with its DIČ", () => {
    expect(mapRuzSubjectToContactPrefill(RUZ)).toEqual({
      ico: "35763469",
      dic: "2020273893",
      legalName: "Slovak Telekom, a.s.",
      isVatPayer: null,
      addressStreet: "Bajkalská 28",
      addressCity: "Bratislava",
      addressPostalCode: "81762",
      addressCountry: "SK",
    });
  });

  it("adds the RÚZ DIČ to RPO data only for the same IČO and keeps RPO's address", () => {
    const rpo = mapRpoSubjectToContactPrefill(RPO);
    expect(withRuzDic(rpo, RUZ)).toEqual({ ...rpo, dic: "2020273893" });
    expect(withRuzDic(rpo, { ...RUZ, ico: "36319198" })).toBe(rpo);
    expect(withRuzDic(rpo, { ...RUZ, dic: null })).toBe(rpo);
    expect(withRuzDic(rpo, null)).toBe(rpo);
    expect(withRuzDic({ ...rpo, dic: "2099999999" }, RUZ).dic).toBe("2099999999");
  });
});

function makeSubject(overrides: Partial<AresSubject> = {}): AresSubject {
  return {
    ico: "27604977",
    dic: "CZ27604977",
    obchodniJmeno: "Novák Consulting s.r.o.",
    sidlo: {
      nazevUlice: "Letenská",
      cisloDomovni: 525,
      cisloOrientacni: 15,
      nazevObce: "Praha",
      psc: 11800,
      kodStatu: "CZ",
    },
    ...overrides,
  };
}

describe("mapAresSubjectToContactPrefill", () => {
  it("maps a full ARES subject to the contact-prefill shape", () => {
    const result = mapAresSubjectToContactPrefill(makeSubject());

    expect(result).toEqual({
      ico: "27604977",
      dic: "CZ27604977",
      legalName: "Novák Consulting s.r.o.",
      isVatPayer: null,
      addressStreet: "Letenská 525/15",
      addressCity: "Praha",
      addressPostalCode: "11800",
      addressCountry: "CZ",
    });
  });

  it("pads a postal code that ARES returns without a leading zero (as a number)", () => {
    const result = mapAresSubjectToContactPrefill(
      makeSubject({ sidlo: { nazevObce: "Praha", psc: 1000, kodStatu: "CZ" } }),
    );
    expect(result.addressPostalCode).toBe("01000");
  });

  it("falls back to textovaAdresa when structured street fields are absent", () => {
    const result = mapAresSubjectToContactPrefill(
      makeSubject({
        sidlo: { textovaAdresa: "Náměstí Míru 1, 120 00 Praha 2", nazevObce: "Praha", kodStatu: "CZ" },
      }),
    );
    expect(result.addressStreet).toBe("Náměstí Míru 1, 120 00 Praha 2");
  });

  it("builds the street of a village without street names from the village part and house number", () => {
    const result = mapAresSubjectToContactPrefill(
      makeSubject({
        sidlo: {
          textovaAdresa: "Lhota 12, 25001 Kostelec",
          nazevObce: "Kostelec",
          nazevCastiObce: "Lhota",
          cisloDomovni: 12,
          psc: 25001,
          kodStatu: "CZ",
        },
      }),
    );
    expect([result.addressStreet, result.addressCity, result.addressPostalCode]).toEqual(["Lhota 12", "Kostelec", "25001"]);
  });

  it("never fabricates isVatPayer=false from dic presence alone – stays null (unknown) unless ARES explicitly says so", () => {
    const result = mapAresSubjectToContactPrefill(makeSubject({ dic: "CZ27604977", platceDph: undefined }));
    expect(result.isVatPayer).toBeNull();
  });

  it("passes through platceDph=true when ARES does report it", () => {
    const result = mapAresSubjectToContactPrefill(makeSubject({ platceDph: true }));
    expect(result.isVatPayer).toBe(true);
  });

  it("defaults addressCountry to CZ and leaves address fields null with no sidlo at all", () => {
    const result = mapAresSubjectToContactPrefill(makeSubject({ sidlo: undefined }));
    expect(result.addressCountry).toBe("CZ");
    expect(result.addressStreet).toBeNull();
    expect(result.addressCity).toBeNull();
    expect(result.addressPostalCode).toBeNull();
  });
});
