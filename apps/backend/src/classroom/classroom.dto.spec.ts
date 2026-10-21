import { describe, expect, it } from "vitest";
import { accountantSchema, applySchema, createCompanySchema, normalizeNickname, partnersSchema, teamSchema } from "./classroom.dto";
import { SCHOOL_LEVELS } from "./tracks";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("phase 2 dtos", () => {
  it("wants a company for exactly one student or team", () => {
    expect(createCompanySchema.safeParse({ studentId: id(1), kind: "cz_vat_sro" }).success).toBe(true);
    expect(createCompanySchema.safeParse({ teamId: id(1), kind: "cz_vat_sro", label: " Dodavatel " }).data?.label).toBe("Dodavatel");
    expect(createCompanySchema.safeParse({ kind: "cz_vat_sro" }).success).toBe(false);
    expect(createCompanySchema.safeParse({ studentId: id(1), teamId: id(2), kind: "cz_vat_sro" }).success).toBe(false);
    expect(createCompanySchema.safeParse({ studentId: id(1), kind: "evil" }).success).toBe(false);
  });

  it("pairs two different companies", () => {
    expect(partnersSchema.safeParse({ tenantA: id(1), tenantB: id(2) }).success).toBe(true);
    expect(partnersSchema.safeParse({ tenantA: id(1), tenantB: id(1) }).success).toBe(false);
  });

  it("makes a bookkeeper unless told otherwise", () => {
    expect(accountantSchema.parse({ tenantId: id(1), studentId: id(2) }).mode).toBe("bookkeeper");
    expect(accountantSchema.safeParse({ tenantId: id(1), studentId: id(2), mode: "owner" }).success).toBe(false);
  });

  it("names teams briefly", () => {
    expect(teamSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(teamSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });
});

describe("normalizeNickname", () => {
  it("accepts first names with an initial and diacritics", () => {
    expect(normalizeNickname("  Pepa   N. ")).toBe("Pepa N.");
    expect(normalizeNickname("Žofie Ř")).toBe("Žofie Ř");
    expect(normalizeNickname("ab")).toBe("ab");
  });

  it("rejects what is not a nickname", () => {
    expect(normalizeNickname("a")).toBeNull();
    expect(normalizeNickname("x".repeat(31))).toBeNull();
    expect(normalizeNickname("jana@skola.cz")).toBeNull();
    expect(normalizeNickname("<script>")).toBeNull();
    expect(normalizeNickname(42)).toBeNull();
  });
});

describe("applySchema webUrl", () => {
  const base = { country: "CZ", ico: "12345678", schoolName: "OA Praha", level: SCHOOL_LEVELS[0], name: "Jana", acceptTerms: true };
  const parse = (webUrl: unknown) => applySchema.safeParse({ ...base, webUrl });

  it("keeps http(s) addresses", () => {
    expect(parse(" https://www.oa-praha.cz/kontakt ").data?.webUrl).toBe("https://www.oa-praha.cz/kontakt");
    expect(parse("http://zs.sk").success).toBe(true);
  });

  it("treats an empty field as none", () => {
    const r = parse("  ");
    expect(r.success).toBe(true);
    expect(r.data?.webUrl).toBeUndefined();
  });

  it("rejects anything a link must not open", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://oa.cz", "oa-praha.cz", "https://localhost"]) {
      expect(parse(bad).success, bad).toBe(false);
    }
  });
});
