import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * GoPay payment states. Sourced from general knowledge of GoPay's public
 * REST API shape — NOT verified against GoPay's current live API
 * reference as part of this change. Confirm the exact literal values
 * (and casing) against https://doc.gopay.com/ before relying on this in
 * production; GoPay has historically documented this as the `state`
 * field on `GET /api/payments/payment/{id}`.
 */
export type GopayPaymentState =
  | "CREATED"
  | "PAYMENT_METHOD_CHOSEN"
  | "PAID"
  | "AUTHORIZED"
  | "CANCELED"
  | "TIMEOUTED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "FAILED";

export interface GopayPaymentStatus {
  /** GoPay's payment id — same id passed to us in the webhook notification. */
  id: string;
  state: GopayPaymentState;
  /**
   * Whatever field identifies the payer/recurrence for our
   * `tenants.gopay_payer_id` mapping. NOT VERIFIED: GoPay's API has used
   * different shapes for this across API versions/docs revisions (a
   * `payer.contact` block, a `recurrence.recurrence_id`, etc) — this is a
   * placeholder field name pending confirmation against live docs, not a
   * confirmed contract.
   */
  payerId: string | null;
  /**
   * What was paid, without VAT, in minor units, plus whether it covered more
   * than a month. Feeds the referral reward (migration 0079); left out until
   * the real client maps GoPay's `amount`/`currency`, and a payment without
   * it does not count towards one.
   */
  amountMinor?: number | null;
  currency?: string | null;
  longPeriod?: boolean;
}

/**
 * Thin wrapper around GoPay's REST API.
 *
 * ============================================================================
 * NOT VERIFIED AGAINST LIVE GOPAY DOCS — read before shipping to production.
 * ============================================================================
 * Unlike Stripe, GoPay's webhook/notification callback does not sign its
 * payload — per blueprint §5 and GoPay's generally documented pattern, the
 * notification just tells you "payment {id} changed," and the receiver is
 * expected to call back GoPay's API to fetch the authoritative, trustworthy
 * state. That control-flow shape (`BillingService.handleGopayWebhook`) is
 * real and deliberate. What is NOT real/verified here is the exact HTTP
 * contract below:
 *   - The OAuth client-credentials token endpoint/grant shape.
 *   - The exact status-check URL and response field names (`state`,
 *     whatever payer-identifying field actually comes back).
 * Confirm both against https://doc.gopay.com/ (GoPay REST API reference)
 * before this goes live — do not treat `getPaymentStatus`'s current
 * (stubbed, throwing) implementation as a working integration.
 */
@Injectable()
export class GopayClient {
  private readonly logger = new Logger(GopayClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * TODO (real implementation, pending GoPay live-docs verification):
   *   1. POST to GoPay's OAuth token endpoint (client_credentials grant,
   *      HTTP Basic auth with GOPAY_CLIENT_ID:GOPAY_CLIENT_SECRET, scope
   *      `payment-all`) to obtain a bearer access token — cache/reuse it
   *      until expiry instead of fetching one per call.
   *   2. `GET` GoPay's payment-status endpoint for `paymentId` with that
   *      bearer token (conceptually
   *      `https://gate.gopay.cz/api/payments/payment/{paymentId}` — confirm
   *      the exact path/host against current docs).
   *   3. Map the response's state field (and whatever payer-identifying
   *      field GoPay actually returns) onto `GopayPaymentStatus`.
   *
   * Deliberately throws rather than returning fabricated data, so a
   * misconfigured/unfinished integration fails loudly instead of silently
   * "succeeding" with made-up status data.
   */
  async getPaymentStatus(paymentId: string): Promise<GopayPaymentStatus> {
    void this.config; // referenced once real HTTP calls read GOPAY_CLIENT_ID/SECRET from it
    this.logger.error(
      `GopayClient.getPaymentStatus(${paymentId}) called but not implemented – ` +
        "see the TODO in gopay.client.ts. GoPay's exact API contract needs verification " +
        "against https://doc.gopay.com/ before this can process a real webhook.",
    );
    throw new Error(
      "GopayClient.getPaymentStatus() is a stub. Implement the real GoPay OAuth + " +
        "status-check API call (see doc comment) before enabling GoPay webhooks in production.",
    );
  }
}
