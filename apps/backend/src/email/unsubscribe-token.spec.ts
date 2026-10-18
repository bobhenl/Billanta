import { describe, expect, it } from "vitest";
import { listUnsubscribeHeaders, signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const claims = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", type: "invoice_paid" as const };

describe("unsubscribe tokens", () => {
  it("round-trips the claims", () => {
    const token = signUnsubscribeToken(claims, "secret-a");
    expect(verifyUnsubscribeToken(token, "secret-a")).toEqual(claims);
  });

  it("rejects another secret, a changed payload and junk", () => {
    const token = signUnsubscribeToken(claims, "secret-a");
    expect(verifyUnsubscribeToken(token, "secret-b")).toBeNull();
    const [, sig] = token.split(".");
    const forged = Buffer.from(`${claims.tenantId}.33333333-3333-4333-8333-333333333333.all`).toString("base64url");
    expect(verifyUnsubscribeToken(`${forged}.${sig}`, "secret-a")).toBeNull();
    expect(verifyUnsubscribeToken("nope", "secret-a")).toBeNull();
    expect(verifyUnsubscribeToken(`${token}.x`, "secret-a")).toBeNull();
  });

  it("rejects a validly signed token with an unknown type or a non-uuid id", () => {
    const bad = signUnsubscribeToken({ ...claims, type: "security_alert" as never }, "s");
    expect(verifyUnsubscribeToken(bad, "s")).toBeNull();
    const notUuid = signUnsubscribeToken({ ...claims, userId: "admin" }, "s");
    expect(verifyUnsubscribeToken(notUuid, "s")).toBeNull();
  });

  it("builds RFC 8058 headers pointing at the one-click endpoint", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://billanta.example/";
    expect(listUnsubscribeHeaders("tok")).toEqual({
      "List-Unsubscribe": "<https://billanta.example/api/email/unsubscribe/tok>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
});
