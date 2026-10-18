import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, CODE_LENGTH, formatCode, generateCode, hashCode, normalizeCode } from "./codes";

describe("classroom codes", () => {
  it("generates codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it("normalises spacing, dashes and case", () => {
    expect(normalizeCode("abcd 2345")).toBe("ABCD2345");
    expect(normalizeCode(" ABCD-2345 ")).toBe("ABCD2345");
    expect(normalizeCode(formatCode("ABCD2345"))).toBe("ABCD2345");
  });

  it("rejects what cannot be a code", () => {
    expect(normalizeCode("ABC")).toBeNull();
    expect(normalizeCode("ABCD23456")).toBeNull();
    expect(normalizeCode("ABCD-0OIL")).toBeNull();
    expect(normalizeCode(12345678)).toBeNull();
  });

  it("hashes with the secret", () => {
    expect(hashCode("ABCD2345", "a")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode("ABCD2345", "a")).not.toBe(hashCode("ABCD2345", "b"));
  });
});
