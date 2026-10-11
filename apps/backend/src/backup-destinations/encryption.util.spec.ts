import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./encryption.util";

const TEST_KEY = randomBytes(32).toString("hex");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext secret", () => {
    const plaintext = "1//0gExampleRefreshTokenValueLooksLikeThis";
    const encrypted = encryptSecret(plaintext, TEST_KEY);
    expect(decryptSecret(encrypted, TEST_KEY)).toBe(plaintext);
  });

  it("round-trips an empty string", () => {
    const encrypted = encryptSecret("", TEST_KEY);
    expect(decryptSecret(encrypted, TEST_KEY)).toBe("");
  });

  it("round-trips unicode content", () => {
    const plaintext = "webhook-secret-with-emoji-🔐-and-diacritics-ěščřžýáíé";
    const encrypted = encryptSecret(plaintext, TEST_KEY);
    expect(decryptSecret(encrypted, TEST_KEY)).toBe(plaintext);
  });

  it("never stores the plaintext as a substring of the encrypted value", () => {
    const plaintext = "sk_webhook_super_secret_value_0001";
    const encrypted = encryptSecret(plaintext, TEST_KEY);
    expect(encrypted).not.toContain(plaintext);
  });

  it("produces a different ciphertext each time (random IV per call), even for the same plaintext", () => {
    const plaintext = "same-secret-both-times";
    const first = encryptSecret(plaintext, TEST_KEY);
    const second = encryptSecret(plaintext, TEST_KEY);
    expect(first).not.toBe(second);
    // ...but both still decrypt back to the same plaintext.
    expect(decryptSecret(first, TEST_KEY)).toBe(plaintext);
    expect(decryptSecret(second, TEST_KEY)).toBe(plaintext);
  });

  it("stores the value as '<iv-hex>:<authTag-hex>:<ciphertext-hex>'", () => {
    const encrypted = encryptSecret("value", TEST_KEY);
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV -> 24 hex chars
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag -> 32 hex chars
    expect(parts[2]).toMatch(/^[0-9a-f]*$/);
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptSecret("value", TEST_KEY);
    const wrongKey = randomBytes(32).toString("hex");
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });

  it("fails to decrypt tampered ciphertext (GCM auth-tag verification)", () => {
    const encrypted = encryptSecret("value", TEST_KEY);
    const [iv, authTag, ciphertext] = encrypted.split(":");
    // Flip a hex character in the ciphertext portion.
    const tamperedByte = ciphertext[0] === "0" ? "1" : "0";
    const tampered = [iv, authTag, tamperedByte + ciphertext.slice(1)].join(":");
    expect(() => decryptSecret(tampered, TEST_KEY)).toThrow();
  });

  it("fails to decrypt a tampered auth tag", () => {
    const encrypted = encryptSecret("value", TEST_KEY);
    const [iv, authTag, ciphertext] = encrypted.split(":");
    const tamperedByte = authTag[0] === "0" ? "1" : "0";
    const tampered = [iv, tamperedByte + authTag.slice(1), ciphertext].join(":");
    expect(() => decryptSecret(tampered, TEST_KEY)).toThrow();
  });

  it("throws a clear error when the key env var is missing", () => {
    expect(() => encryptSecret("value", undefined)).toThrow(/BACKUP_CONFIG_ENCRYPTION_KEY/);
    expect(() => decryptSecret("aa:bb:cc", undefined)).toThrow(/BACKUP_CONFIG_ENCRYPTION_KEY/);
  });

  it("throws a clear error when the key is the wrong length", () => {
    expect(() => encryptSecret("value", "deadbeef")).toThrow(/32 bytes/);
  });

  it("throws on a malformed stored value (wrong number of parts)", () => {
    expect(() => decryptSecret("not-even-close", TEST_KEY)).toThrow(/Malformed/);
    expect(() => decryptSecret("aa:bb", TEST_KEY)).toThrow(/Malformed/);
  });
});
