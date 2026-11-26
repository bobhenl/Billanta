import { ConflictException } from "@nestjs/common";
import { sealedMaxLength } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { assertServerReadable, plainOrNull, redactSealedInvoice, redactSealedItem, sealableText, SEALED_PLACEHOLDER } from "./sealed";

// A well-formed envelope: 16 base64 chars of IV, then ciphertext.
const envelope = (ctLength: number) => `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(ctLength)}`;

describe("assertServerReadable", () => {
  it("lets plain text through and refuses an envelope", () => {
    expect(() => assertServerReadable("Konzultace", null, undefined)).not.toThrow();
    expect(() => assertServerReadable("Konzultace", envelope(24))).toThrow(ConflictException);
  });

  it("does not mistake text that only starts like an envelope", () => {
    expect(() => assertServerReadable("enc:v1: poznámka")).not.toThrow();
  });
});

describe("sealableText", () => {
  const schema = sealableText(10);

  it("keeps the plain limit for plain text", () => {
    expect(schema.safeParse("a".repeat(10)).success).toBe(true);
    expect(schema.safeParse("a".repeat(11)).success).toBe(false);
  });

  it("accepts an envelope longer than the plain limit, up to what that limit can seal to", () => {
    const max = sealedMaxLength(10);
    const fits = envelope(max - "enc:v1:AAAAAAAAAAAAAAAA:".length);
    expect(fits.length).toBe(max);
    expect(schema.safeParse(fits).success).toBe(true);
    expect(schema.safeParse(fits + "QQQQ").success).toBe(false);
  });
});

describe("redaction", () => {
  it("replaces only the encrypted fields", () => {
    const invoice = redactSealedInvoice({ noteAbove: envelope(24), noteBelow: "Děkujeme", internalNote: null });
    expect(invoice).toEqual({ noteAbove: SEALED_PLACEHOLDER, noteBelow: "Děkujeme", internalNote: null });
    expect(redactSealedItem({ description: envelope(24), qty: 1 })).toEqual({ description: SEALED_PLACEHOLDER, qty: 1 });
    expect(redactSealedItem({ description: "Práce" })).toEqual({ description: "Práce" });
  });

  it("hides envelopes from search", () => {
    expect(plainOrNull(envelope(24))).toBeNull();
    expect(plainOrNull("Práce")).toBe("Práce");
  });
});
