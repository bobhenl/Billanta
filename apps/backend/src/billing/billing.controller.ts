import { Controller, Headers, HttpCode, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { BillingService } from "./billing.service";

@ApiTags("billing")
@Controller("v1/billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * Stripe webhook (blueprint §5). Deliberately NOT behind
   * `TenantContextMiddleware`/`JwtAuthGuard` — Stripe authenticates via the
   * `Stripe-Signature` header (verified against the raw body), not a
   * bearer JWT, and `BillingService` resolves the affected tenant from the
   * event payload itself (`metadata.tenantId` for `checkout.session
   * .completed`, `stripe_customer_id` for everything else).
   */
  @Post("stripe/webhook")
  @HttpCode(200)
  @ApiOperation({
    summary: "Stripe billing webhook",
    description:
      "Verifies Stripe-Signature against the raw request body via " +
      "Stripe.webhooks.constructEvent (blueprint §5), then applies " +
      "checkout.session.completed / customer.subscription.updated|deleted / " +
      "invoice.payment_failed|paid with subscription_events-keyed idempotency.",
  })
  handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature: string | undefined,
  ) {
    return this.billingService.handleStripeWebhook(req.rawBody, signature);
  }

  /**
   * GoPay webhook (blueprint §5) — same "not behind tenant middleware"
   * rationale as Stripe's above, but a different auth shape: GoPay's
   * notification callback is an unsigned ping that only identifies which
   * payment changed (typically `?id=...` on the callback URL — accepted
   * here from either the query string or a JSON body field, since the
   * exact live delivery shape isn't confirmed — see `GopayClient`'s doc
   * comment). The handler always calls back GoPay's status API before
   * trusting anything about the payment's state; it never acts on
   * unverified data taken directly from this request.
   */
  @Post("gopay/webhook")
  @HttpCode(200)
  @ApiOperation({
    summary: "GoPay billing webhook",
    description:
      "Accepts a GoPay payment id (query `id` or JSON body `id`/`payment_id`), then calls " +
      "back GoPay's status-check API (GopayClient) for the authoritative payment state " +
      "before updating tenants/subscription_events — GoPay's notification payload itself " +
      "is never trusted directly (blueprint §5). NOTE: GopayClient's HTTP call is a TODO " +
      "stub pending verification against GoPay's live API docs.",
  })
  handleGopayWebhook(@Req() req: RawBodyRequest<Request>, @Query("id") queryId?: string) {
    const paymentId = queryId ?? this.extractBodyPaymentId(req);
    return this.billingService.handleGopayWebhook(paymentId);
  }

  private extractBodyPaymentId(req: RawBodyRequest<Request>): string | undefined {
    const body = req.body as { id?: string; payment_id?: string } | undefined;
    const value = body?.id ?? body?.payment_id;
    return typeof value === "string" ? value : undefined;
  }
}
