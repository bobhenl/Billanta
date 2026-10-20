import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Newsletter links.
 *
 * Unsubscribe: same `<payload>.<signature>` shape as the member links in
 * `email/unsubscribe-token.ts`, so the existing `/unsubscribe/<token>` page
 * and the one-click route take both, but under its own HMAC label: a member
 * token can never verify as a newsletter token or the other way round.
 * Payload is base64url("nl:<subscriberId>"). No expiry, for the same reason
 * as member links (a mail client may POST List-Unsubscribe months later).
 *
 * Confirmation (double opt-in): 32 random bytes; only the sha256 is stored,
 * so a database read does not yield working links.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(payload: string, secret: string): string {
  const key = createHmac("sha256", secret).update("billanta:newsletter-unsubscribe:v1").digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function signNewsletterUnsubscribeToken(subscriberId: string, secret: string): string {
  const payload = Buffer.from(`nl:${subscriberId}`).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The subscriber id, or null for anything that is not a valid newsletter token. */
export function verifyNewsletterUnsubscribeToken(token: string, secret: string): string | null {
  if (typeof token !== "string" || token.length > 400) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  if (!decoded.startsWith("nl:")) return null;
  const id = decoded.slice(3);
  return UUID.test(id) ? id : null;
}

/** The confirmation token shape: 32 bytes in base64url. */
export const CONFIRM_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashConfirmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newConfirmToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashConfirmToken(token) };
}
