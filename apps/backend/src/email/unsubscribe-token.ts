import { createHmac, timingSafeEqual } from "node:crypto";
import { isUnsubscribeType, type UnsubscribeType } from "./email-types";

/**
 * Signed one-click unsubscribe links: `<payload>.<signature>`, where payload
 * is base64url("<tenantId>.<userId>.<type>") and the signature an
 * HMAC-SHA256 of it under a key derived from JWT_SECRET (no new secret to
 * manage). They don't expire: a mail client may POST the List-Unsubscribe
 * URL months after the e-mail arrived. Rotating JWT_SECRET voids old links,
 * which only means the recipient unsubscribes in Settings instead.
 */
export interface UnsubscribeClaims {
  tenantId: string;
  userId: string;
  type: UnsubscribeType;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyOf(secret: string): Buffer {
  return createHmac("sha256", secret).update("billanta:email-unsubscribe:v1").digest();
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", keyOf(secret)).update(payload).digest("base64url");
}

export function unsubscribeSecret(): string | null {
  return process.env.JWT_SECRET || null;
}

export function signUnsubscribeToken(claims: UnsubscribeClaims, secret: string): string {
  const payload = Buffer.from(`${claims.tenantId}.${claims.userId}.${claims.type}`).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribeClaims | null {
  if (typeof token !== "string" || token.length > 400) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [tenantId, userId, type, rest] = Buffer.from(payload, "base64url").toString("utf8").split(".");
  if (rest !== undefined || !tenantId || !userId || !type) return null;
  if (!UUID.test(tenantId) || !UUID.test(userId) || !isUnsubscribeType(type)) return null;
  return { tenantId, userId, type };
}

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");

/** The page a person opens from the link in the e-mail footer. */
export function unsubscribePageUrl(token: string, locale = "cs"): string {
  return `${siteUrl()}/${locale}/unsubscribe/${token}`;
}

/** RFC 8058 one-click endpoint (the frontend route forwards the POST to the backend). */
export function oneClickUnsubscribeUrl(token: string): string {
  return `${siteUrl()}/api/email/unsubscribe/${token}`;
}

/** `List-Unsubscribe` + `List-Unsubscribe-Post` for a non-transactional e-mail. */
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
