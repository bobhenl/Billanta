import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Svix-signed webhook (Resend signs its webhooks with Svix):
 * the signed content is `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256
 * keyed with the base64 part of the `whsec_…` secret, and `svix-signature`
 * holds one or more space-separated `v1,<base64>` entries (several during a
 * secret rotation). Timestamps more than `toleranceSeconds` away are refused
 * so a captured request can't be replayed later.
 *
 * Written against Svix's published verification scheme rather than pulling
 * in the `svix` package, because Resend's own `webhooks.verify` helper needs
 * a client constructed with an API key, and the webhook must work (and be
 * testable) without one.
 */
export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type SvixResult = { ok: true } | { ok: false; reason: "missing_headers" | "bad_secret" | "stale_timestamp" | "bad_signature" };

export function svixSecretKey(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(raw, "base64");
  return key.length > 0 ? key : null;
}

export function svixSign(id: string, timestamp: string, body: string, key: Buffer): string {
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifySvixSignature(headers: SvixHeaders, rawBody: string, secret: string, now = new Date(), toleranceSeconds = 300): SvixResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  const key = svixSecretKey(secret);
  if (!key) return { ok: false, reason: "bad_secret" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > toleranceSeconds) return { ok: false, reason: "stale_timestamp" };
  const expected = Buffer.from(svixSign(id, timestamp, rawBody, key));
  for (const entry of signature.split(" ")) {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}
