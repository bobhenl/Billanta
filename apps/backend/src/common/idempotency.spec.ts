import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseIdempotencyKey } from "./idempotency";

describe("parseIdempotencyKey", () => {
  it("treats a missing or empty header as no key", () => {
    expect(parseIdempotencyKey(undefined)).toBeNull();
    expect(parseIdempotencyKey("")).toBeNull();
  });

  it("accepts a UUID and takes the first of repeated headers", () => {
    const id = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";
    expect(parseIdempotencyKey(id)).toBe(id);
    expect(parseIdempotencyKey([id, "other-key-123"])).toBe(id);
  });

  it("rejects malformed keys instead of ignoring them", () => {
    for (const bad of ["short", "x".repeat(101), "has space in it", "semi;colon;key"]) {
      expect(() => parseIdempotencyKey(bad)).toThrow(BadRequestException);
    }
  });
});
