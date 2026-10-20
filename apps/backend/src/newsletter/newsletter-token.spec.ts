import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../email/unsubscribe-token";
import {
  CONFIRM_TOKEN,
  hashConfirmToken,
  newConfirmToken,
  signNewsletterUnsubscribeToken,
  verifyNewsletterUnsubscribeToken,
} from "./newsletter-token";

const SECRET = "test-secret";
const ID = "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f";
// The frontend's /unsubscribe/<token> route accepts only this shape.
const FRONTEND_SHAPE = /^[A-Za-z0-9_-]{20,300}\.[A-Za-z0-9_-]{20,100}$/;

describe("newsletter unsubscribe token", () => {
  it("round-trips and fits the existing unsubscribe route", () => {
    const token = signNewsletterUnsubscribeToken(ID, SECRET);
    expect(token).toMatch(FRONTEND_SHAPE);
    expect(verifyNewsletterUnsubscribeToken(token, SECRET)).toBe(ID);
  });

  it("rejects a wrong secret or a tampered payload", () => {
    const token = signNewsletterUnsubscribeToken(ID, SECRET);
    expect(verifyNewsletterUnsubscribeToken(token, "other")).toBeNull();
    const [, sig] = token.split(".");
    const forged = `${Buffer.from("nl:00000000-0000-4000-8000-000000000000").toString("base64url")}.${sig}`;
    expect(verifyNewsletterUnsubscribeToken(forged, SECRET)).toBeNull();
    expect(verifyNewsletterUnsubscribeToken(`${token}.x`, SECRET)).toBeNull();
  });

  it("never accepts a member token or the other way round", () => {
    const member = signUnsubscribeToken({ tenantId: ID, userId: ID, type: "all" }, SECRET);
    expect(verifyNewsletterUnsubscribeToken(member, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(signNewsletterUnsubscribeToken(ID, SECRET), SECRET)).toBeNull();
  });
});

describe("confirmation token", () => {
  it("is random, url-safe and stored only as a hash", () => {
    const a = newConfirmToken();
    const b = newConfirmToken();
    expect(a.token).toMatch(CONFIRM_TOKEN);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashConfirmToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
