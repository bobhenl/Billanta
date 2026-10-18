import { describe, expect, it } from "vitest";
import { normalizeNickname } from "./classroom.dto";

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
