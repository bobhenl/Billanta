import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX, apiKeyAllowsMethod, generateApiKey, hashApiKey, isApiKeyFormat } from "./api-key.util";

describe("hashApiKey", () => {
  it("produces a SHA-256 hex digest, not the plaintext key", () => {
    const raw = `${API_KEY_PREFIX}thisIsATestKeyValue1234`;
    const hash = hashApiKey(raw);

    expect(hash).not.toBe(raw);
    // SHA-256 hex digest is always 64 lowercase hex characters.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // The digest never contains the plaintext as a substring either — a
    // sanity check that this isn't, say, base64/reversible encoding.
    expect(hash).not.toContain(raw);
  });

  it("is deterministic — the same key always hashes to the same digest", () => {
    const raw = `${API_KEY_PREFIX}deterministicExample0001`;
    expect(hashApiKey(raw)).toBe(hashApiKey(raw));
  });

  it("produces different digests for different keys (no trivial collisions)", () => {
    const { fullKey: keyA } = generateApiKey();
    const { fullKey: keyB } = generateApiKey();

    expect(keyA).not.toBe(keyB);
    expect(hashApiKey(keyA)).not.toBe(hashApiKey(keyB));
  });

  it("cannot be trivially reversed: two DIFFERENT plaintext-like guesses near the real key never hash to the same digest as the real key", () => {
    // Not a proof of one-wayness (no test can be), but demonstrates the
    // property that matters operationally: an attacker holding only
    // `key_hash` (what's actually persisted — see ApiKeysService.create)
    // gains no shortcut to a matching plaintext by guessing nearby strings.
    const real = `${API_KEY_PREFIX}abcdefghijklmnopqrstuv01`;
    const guessedSameLength = `${API_KEY_PREFIX}abcdefghijklmnopqrstuv02`;
    expect(hashApiKey(real)).not.toBe(hashApiKey(guessedSameLength));
  });
});

describe("generateApiKey", () => {
  it("produces a key with the sk_live_ prefix", () => {
    const { fullKey } = generateApiKey();
    expect(fullKey.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("derives keyPrefix as the first 12 characters of the full key", () => {
    const { fullKey, keyPrefix } = generateApiKey();
    expect(keyPrefix).toHaveLength(12);
    expect(fullKey.startsWith(keyPrefix)).toBe(true);
  });

  it("generates a fresh random key on every call", () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(first.fullKey).not.toBe(second.fullKey);
  });
});

describe("isApiKeyFormat", () => {
  it("recognizes a generated key", () => {
    const { fullKey } = generateApiKey();
    expect(isApiKeyFormat(fullKey)).toBe(true);
  });

  it("rejects a JWT-shaped token", () => {
    expect(isApiKeyFormat("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isApiKeyFormat("")).toBe(false);
  });
});

describe("apiKeyAllowsMethod", () => {
  it("keeps full access for keys without scopes", () => {
    expect(apiKeyAllowsMethod([], "POST")).toBe(true);
    expect(apiKeyAllowsMethod([], "DELETE")).toBe(true);
  });

  it("limits read-only keys to safe methods", () => {
    expect(apiKeyAllowsMethod(["read"], "GET")).toBe(true);
    expect(apiKeyAllowsMethod(["read"], "head")).toBe(true);
    expect(apiKeyAllowsMethod(["read"], "POST")).toBe(false);
    expect(apiKeyAllowsMethod(["read"], "PATCH")).toBe(false);
    expect(apiKeyAllowsMethod(["read"], "DELETE")).toBe(false);
  });

  it("allows writes with a write scope, including legacy resource scopes", () => {
    expect(apiKeyAllowsMethod(["read", "write"], "POST")).toBe(true);
    expect(apiKeyAllowsMethod(["invoices:write"], "PUT")).toBe(true);
    expect(apiKeyAllowsMethod(["invoices:read"], "POST")).toBe(false);
  });
});
