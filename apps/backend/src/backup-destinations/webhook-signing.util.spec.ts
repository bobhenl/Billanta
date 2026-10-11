import { describe, expect, it } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from "./webhook-signing.util";

describe("signWebhookPayload", () => {
  it("produces a 'sha256=<64-hex-char digest>' string", () => {
    const signature = signWebhookPayload('{"a":1}', "secret");
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for the same body + secret", () => {
    const body = '{"exportedAt":"2026-09-09T00:00:00.000Z","invoices":[]}';
    expect(signWebhookPayload(body, "my-secret")).toBe(signWebhookPayload(body, "my-secret"));
  });

  it("produces a different signature for a different body", () => {
    const a = signWebhookPayload('{"a":1}', "secret");
    const b = signWebhookPayload('{"a":2}', "secret");
    expect(a).not.toBe(b);
  });

  it("produces a different signature for a different secret", () => {
    const body = '{"a":1}';
    const a = signWebhookPayload(body, "secret-one");
    const b = signWebhookPayload(body, "secret-two");
    expect(a).not.toBe(b);
  });

  it("changes completely for a single-character change in the body (avalanche effect)", () => {
    const a = signWebhookPayload('{"amount":100}', "secret");
    const b = signWebhookPayload('{"amount":101}', "secret");
    expect(a).not.toBe(b);
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a signature produced by signWebhookPayload for the same body+secret", () => {
    const body = '{"invoices":[{"id":"abc"}]}';
    const secret = "tenant-webhook-secret";
    const signature = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, secret, signature)).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    const body = '{"a":1}';
    const signature = signWebhookPayload(body, "secret-a");
    expect(verifyWebhookSignature(body, "secret-b", signature)).toBe(false);
  });

  it("rejects a signature for a tampered body", () => {
    const secret = "secret";
    const signature = signWebhookPayload('{"amount":100}', secret);
    expect(verifyWebhookSignature('{"amount":999}', secret, signature)).toBe(false);
  });

  it("rejects a malformed/short signature without throwing", () => {
    expect(verifyWebhookSignature('{"a":1}', "secret", "not-a-real-signature")).toBe(false);
  });

  it("rejects an empty signature without throwing", () => {
    expect(verifyWebhookSignature('{"a":1}', "secret", "")).toBe(false);
  });
});

describe("WEBHOOK_SIGNATURE_HEADER", () => {
  it("is the documented header name", () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe("X-Faktur-Signature");
  });
});
