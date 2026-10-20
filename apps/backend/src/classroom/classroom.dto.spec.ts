import { describe, expect, it } from "vitest";
import { applySchema, normalizeNickname } from "./classroom.dto";
import { SCHOOL_LEVELS } from "./tracks";

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
