import type { AresSubject } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { mapAresSubjectToContactPrefill } from "./ares-mapper.util";

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

  it("never fabricates isVatPayer=false from dic presence alone — stays null (unknown) unless ARES explicitly says so", () => {
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
