import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Header carrying the HMAC-SHA256 signature of the outbound export payload —
 * this codebase's own equivalent, in the SENDING direction, of how it
 * verifies inbound provider webhooks (`Stripe-Signature`,
 * `BillingService.verifyStripeSignature`). Here, THIS app is the sender:
 * `ExportService` signs the JSON bundle it POSTs to a tenant's configured
 * `webhook_url` with the tenant's own webhook secret (decrypted via
 * `encryption.util.ts`), so the receiving endpoint can verify the payload
 * genuinely came from Faktur and was not tampered with in transit — exactly
 * the same property Stripe's signature gives this app's own webhook
 * receiver, just with the roles reversed.
 */
export const WEBHOOK_SIGNATURE_HEADER = "X-Faktur-Signature";

/**
 * Signs `rawBody` (the exact JSON string that will be sent as the request
 * body — sign the same bytes that go over the wire, not a re-serialized
 * object, for the same reason Stripe's verification needs the raw body: a
 * receiver re-computing the signature must hash byte-for-byte identical
 * input) with HMAC-SHA256 keyed on the tenant's webhook secret. Returns
 * `sha256=<hex digest>` — the `sha256=` prefix names the algorithm
 * explicitly in the header value itself (the same convention GitHub's
 * outbound webhook signatures use), so a receiving endpoint doesn't have to
 * assume which hash function was used.
 */
export function signWebhookPayload(rawBody: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${digest}`;
}

/**
 * Verifies a signature produced by {@link signWebhookPayload}. Not currently
 * called anywhere in this app (Faktur is only ever the SENDER of this
 * signature, never the receiver — a tenant's own webhook endpoint is the
 * verifier), but provided alongside the signing function for completeness,
 * for the tenant-side reference implementation this module's docs point to,
 * and because it is directly useful for testing {@link signWebhookPayload}
 * without duplicating the comparison logic in test code.
 *
 * Uses `timingSafeEqual` (not `===`) for the same reason
 * `ApiKeyAuthGuard`/webhook-signature checks generally do: a naive string
 * comparison short-circuits on the first differing byte, which leaks timing
 * information an attacker could use to guess the correct signature one byte
 * at a time.
 */
export function verifyWebhookSignature(
  rawBody: string,
  secret: string,
  providedSignature: string,
): boolean {
  const expected = signWebhookPayload(rawBody, secret);
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(providedSignature, "utf8");

  // `timingSafeEqual` throws if the two buffers differ in length, so guard
  // that first rather than letting an unequal-length signature throw
  // instead of just failing verification.
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}
