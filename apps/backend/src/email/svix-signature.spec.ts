import { describe, expect, it } from "vitest";
import { svixSecretKey, svixSign, verifySvixSignature } from "./svix-signature";

const secret = `whsec_${Buffer.from("test-webhook-key-0123456789").toString("base64")}`;
const now = new Date("2026-10-14T10:00:00Z");
const ts = String(Math.floor(now.getTime() / 1000));
const body = '{"type":"email.bounced","data":{"email_id":"m1"}}';
const sig = (b = body, t = ts, id = "msg_1") => `v1,${svixSign(id, t, b, svixSecretKey(secret)!)}`;

describe("verifySvixSignature", () => {
  it("accepts a correct signature, also among several (secret rotation)", () => {
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: sig() }, body, secret, now)).toEqual({ ok: true });
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sig()}` }, body, secret, now)).toEqual({ ok: true });
  });

  it("rejects a changed body, id or another secret", () => {
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: sig() }, body + " ", secret, now).ok).toBe(false);
    expect(verifySvixSignature({ id: "msg_2", timestamp: ts, signature: sig() }, body, secret, now).ok).toBe(false);
    const other = `whsec_${Buffer.from("another-key").toString("base64")}`;
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: sig() }, body, other, now)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects stale timestamps and missing headers", () => {
    const old = String(Number(ts) - 301);
    expect(verifySvixSignature({ id: "msg_1", timestamp: old, signature: sig(body, old) }, body, secret, now)).toEqual({
      ok: false,
      reason: "stale_timestamp",
    });
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: undefined }, body, secret, now)).toEqual({
      ok: false,
      reason: "missing_headers",
    });
  });

  it("ignores entries of another version", () => {
    const v2 = sig().replace("v1,", "v2,");
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signature: v2 }, body, secret, now).ok).toBe(false);
  });
});
