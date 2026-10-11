import { describe, expect, it } from "vitest";
import { fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("ignores case and accents", () => {
    expect(fuzzyScore("novak", ["Jan Novák s.r.o."])).toBeGreaterThan(0);
    expect(fuzzyScore("ÚČETNÍ", ["ucetni kancelar"])).toBeGreaterThan(0);
  });

  it("forgives one typo in words of 4+ letters, including swapped letters", () => {
    expect(fuzzyScore("novk", ["Novák"])).toBeGreaterThan(0);
    expect(fuzzyScore("fkatura", ["Faktura za služby"])).toBeGreaterThan(0);
    expect(fuzzyScore("nobak", ["Novák"])).toBeGreaterThan(0);
  });

  it("requires every token and doesn't match unrelated text", () => {
    expect(fuzzyScore("novak praha", ["Novák", "Brno"])).toBe(0);
    expect(fuzzyScore("xyz", ["Novák"])).toBe(0);
    expect(fuzzyScore("abc", ["abd"])).toBe(0);
  });

  it("ranks prefixes above substrings above typos", () => {
    const prefix = fuzzyScore("fak", ["Faktura"]);
    const inner = fuzzyScore("ktur", ["Faktura"]);
    const typo = fuzzyScore("faktyra", ["Faktura"]);
    expect(prefix).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(0);
  });

  it("matches invoice numbers and symbols as substrings", () => {
    expect(fuzzyScore("0012", ["2026-0012"])).toBeGreaterThan(0);
    expect(fuzzyScore("2026", ["2026-0012"])).toBe(3);
  });
});
