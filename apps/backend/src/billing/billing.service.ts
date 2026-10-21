import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Stripe from "stripe";
// NOTE: `GopayClient`, `SubscriptionEventsRepository`, and
// `TenantBillingRepository` MUST be real (value) imports, not `import
// type` — they're used as constructor-parameter types below, and NestJS's
// dependency injection resolves untagged constructor params via
// `emitDecoratorMetadata`'s `design:paramtypes`, which needs the actual
// runtime class reference to point at. An `import type` erases the import
// entirely at compile time, so the emitted metadata can't identify the
// provider to inject (`Stripe` is exempt from this because its param is
// explicitly tagged with `@Inject(STRIPE_CLIENT)` below, so no type
// reflection is needed for it — see `stripe-client.provider.ts`).
import { GopayClient, type GopayPaymentStatus } from "./gopay.client";
import { isPaidPlan } from "./plans";
import { STRIPE_CLIENT } from "./stripe-client.provider";
import { stripeInvoiceReferralPayment, stripeSubscriptionDetails } from "./stripe-subscription";
import { SubscriptionEventsRepository } from "./subscription-events.repository";
import { TenantBillingRepository, type SubscriptionStatus } from "./tenant-billing.repository";

/**
 * Maps a Stripe subscription's `status` onto this app's narrower
 * `subscription_status` enum (`trialing | active | past_due | canceled`,
 * see `drizzle/schema.ts`). Exported standalone (not a private method) so
 * it's directly unit-testable without constructing a `BillingService`.
 *
 * Stripe has more granular statuses than we track — `unpaid`/`incomplete`
 * fold into `past_due` (still owed money, not yet worth hard-canceling
 * access), `incomplete_expired`/`paused` fold into `canceled` (no active
 * paid access). The `default` branch deliberately fails toward `past_due`
 * (more restrictive than `active`) rather than silently treating an
 * unrecognized future Stripe status as a green light.
 */
export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return "past_due";
  }
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly gopayClient: GopayClient,
    private readonly tenantBilling: TenantBillingRepository,
    private readonly subscriptionEvents: SubscriptionEventsRepository,
  ) {}

  // ---------------------------------------------------------------------
  // Stripe
  // ---------------------------------------------------------------------

  async handleStripeWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: true; skipped?: "tenant-not-resolved" | "duplicate" }> {
    const event = this.verifyStripeSignature(rawBody, signature);

    const tenantId = await this.resolveStripeTenantId(event);
    if (!tenantId) {
      this.logger.warn(
        `Stripe event ${event.id} (${event.type}): could not resolve a tenant – skipping`,
      );
      return { received: true, skipped: "tenant-not-resolved" };
    }

    const isNewEvent = await this.subscriptionEvents.insertIfNew(
      tenantId,
      "stripe",
      event.id,
      event.type,
      event.data.object,
    );
    if (!isNewEvent) {
      this.logger.log(`Stripe event ${event.id} already recorded – skipping duplicate delivery`);
      return { received: true, skipped: "duplicate" };
    }

    await this.applyStripeEvent(tenantId, event);
    await this.subscriptionEvents.markProcessed(tenantId, "stripe", event.id);
    return { received: true };
  }

  /**
   * Verifies `Stripe-Signature` against the RAW request body via
   * `Stripe.webhooks.constructEvent` (blueprint §5). Requires the exact
   * bytes Stripe sent — a JSON-parsed-then-reserialized body will not
   * reproduce the same signature. `main.ts` already bootstraps Nest with
   * `NestFactory.create(AppModule, { rawBody: true })`, which is what
   * makes `req.rawBody` available to `BillingController` — no extra
   * `express.raw()` middleware is needed on top of that (Nest's own
   * `rawBody` option already stashes the raw bytes alongside the
   * normally-parsed JSON body for every request, which is exactly what
   * this handler needs since it also wants a parsed body available
   * elsewhere in the app).
   *
   * Split out from `handleStripeWebhook` as its own method purely so unit
   * tests can assert the "bad signature -> 400" path directly without
   * needing to also mock the DB-touching half of the flow.
   */
  verifyStripeSignature(rawBody: Buffer | undefined, signature: string | undefined): Stripe.Event {
    if (!rawBody) {
      throw new BadRequestException(
        "Missing raw request body for Stripe signature verification (req.rawBody was empty)",
      );
    }
    if (!signature) {
      throw new BadRequestException("Missing Stripe-Signature header");
    }

    const webhookSecret = this.config.get<string>("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      // Misconfiguration, not a client error — surfaces as a 500, not 400.
      throw new Error("STRIPE_WEBHOOK_SECRET is not set – see .env.example");
    }

    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.warn(`Stripe webhook signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException("Invalid Stripe webhook signature");
    }
  }

  /**
   * `checkout.session.completed` carries the tenant id directly (set as
   * `metadata.tenantId`/`client_reference_id` when the Checkout Session
   * was created) — no DB lookup needed, so this path is fully RLS-safe.
   * Every other handled event type only carries a Stripe `customer` id,
   * so it falls through to `TenantBillingRepository
   * .findTenantIdByStripeCustomerId` — see that method's doc comment for
   * the known RLS-bootstrap gap on that specific lookup.
   */
  private async resolveStripeTenantId(event: Stripe.Event): Promise<string | null> {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadataTenantId = session.metadata?.tenantId;
      if (metadataTenantId) {
        return metadataTenantId;
      }
      if (session.client_reference_id) {
        return session.client_reference_id;
      }
      // Fall through to the customer-id lookup below if neither was set —
      // shouldn't happen if Checkout Sessions are always created with one
      // of those two fields, but don't hard-fail here if they weren't.
    }

    const obj = event.data.object as {
      customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
    };
    const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
    if (!customerId) {
      return null;
    }
    return this.tenantBilling.findTenantIdByStripeCustomerId(customerId);
  }

  /** Handles the five event types blueprint §5 names explicitly. */
  private async applyStripeEvent(tenantId: string, event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id;
        // Our own Checkout (SubscriptionService) puts the plan in metadata.
        const plan = session.metadata?.plan;
        const interval = session.metadata?.interval;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        const currency = session.currency?.toUpperCase();
        const extra = {
          ...(customerId ? { stripeCustomerId: customerId } : {}),
          ...(isPaidPlan(plan) ? { subscriptionPlan: plan } : {}),
          ...(interval === "month" || interval === "year" ? { subscriptionInterval: interval as "month" | "year" } : {}),
          // A new subscription starts renewing, whatever an earlier one was set to.
          ...(subscriptionId ? { stripeSubscriptionId: subscriptionId, subscriptionCancelAt: null } : {}),
          ...(currency === "CZK" || currency === "EUR" ? { subscriptionCurrency: currency as "CZK" | "EUR" } : {}),
        };
        await this.tenantBilling.updateSubscriptionStatus(tenantId, "active", Object.keys(extra).length ? extra : undefined);
        return;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const plan = subscription.metadata?.plan;
        // Period end, cancel-at-period-end and interval, so the billing panel
        // reflects a change made in the Customer Portal too.
        const { subscriptionInterval, ...details } = stripeSubscriptionDetails(subscription);
        const status = mapStripeSubscriptionStatus(subscription.status);
        await this.tenantBilling.updateSubscriptionStatus(tenantId, status, {
          ...(isPaidPlan(plan) ? { subscriptionPlan: plan } : {}),
          ...(subscriptionInterval ? { subscriptionInterval } : {}),
          ...details,
        });
        // Ended before the reward was released. A plan merely set to cancel
        // at period end was still paid for in full, so it keeps the reward.
        if (status === "canceled") await this.tenantBilling.voidReferralReward(tenantId, "canceled");
        return;
      }
      case "customer.subscription.deleted": {
        await this.tenantBilling.updateSubscriptionStatus(tenantId, "canceled", { stripeSubscriptionId: null, subscriptionCancelAt: null });
        await this.tenantBilling.voidReferralReward(tenantId, "canceled");
        return;
      }
      case "invoice.payment_failed": {
        await this.tenantBilling.updateSubscriptionStatus(tenantId, "past_due");
        return;
      }
      case "invoice.paid": {
        await this.tenantBilling.clearPastDue(tenantId);
        // Only paid invoices count towards the inviter's reward, never the
        // checkout event: both arrive for the first payment.
        const payment = stripeInvoiceReferralPayment(event.data.object as Stripe.Invoice);
        if (payment) await this.tenantBilling.recordReferralPayment(tenantId, payment);
        return;
      }
      case "charge.refunded": {
        await this.tenantBilling.voidReferralReward(tenantId, "refunded");
        return;
      }
      default:
        this.logger.debug(
          `Stripe event type ${event.type} recorded for tenant ${tenantId}; no tenant ` +
            "state change wired up for it (not one of the five blueprint §5 event types)",
        );
    }
  }

  // ---------------------------------------------------------------------
  // GoPay
  // ---------------------------------------------------------------------

  async handleGopayWebhook(
    paymentId: string | undefined,
  ): Promise<{ received: true; skipped?: "tenant-not-resolved" | "duplicate" }> {
    if (!paymentId) {
      throw new BadRequestException("Missing GoPay payment id in webhook notification");
    }

    // GoPay's notification callback carries no signature/authenticated
    // payload of its own (unlike Stripe) — per blueprint §5 and GoPay's
    // documented pattern, the receiver must call back GoPay's API to fetch
    // the authoritative status. The notification's own body/query beyond
    // the payment id is NEVER trusted for anything state-changing.
    const status = await this.gopayClient.getPaymentStatus(paymentId);

    if (!status.payerId) {
      this.logger.warn(
        `GoPay payment ${paymentId}: status response had no payer id – cannot resolve a tenant`,
      );
      return { received: true, skipped: "tenant-not-resolved" };
    }

    const tenantId = await this.tenantBilling.findTenantIdByGopayPayerId(status.payerId);
    if (!tenantId) {
      this.logger.warn(
        `GoPay payment ${paymentId}: payer ${status.payerId} did not match any tenant – skipping`,
      );
      return { received: true, skipped: "tenant-not-resolved" };
    }

    const isNewEvent = await this.subscriptionEvents.insertIfNew(
      tenantId,
      "gopay",
      status.id,
      `payment.${status.state}`,
      status,
    );
    if (!isNewEvent) {
      this.logger.log(`GoPay payment ${status.id} already recorded – skipping duplicate notification`);
      return { received: true, skipped: "duplicate" };
    }

    await this.applyGopayEvent(tenantId, status);
    await this.subscriptionEvents.markProcessed(tenantId, "gopay", status.id);
    return { received: true };
  }

  /**
   * Mapping of GoPay payment states onto `subscription_status` — same
   * "not verified against live GoPay docs" caveat as `GopayClient` itself
   * (see its doc comment): the specific state literal values are a
   * best-effort placeholder, not a confirmed contract.
   */
  private async applyGopayEvent(tenantId: string, status: GopayPaymentStatus): Promise<void> {
    switch (status.state) {
      case "PAID":
        await this.tenantBilling.updateSubscriptionStatus(tenantId, "active");
        // Counts for a referral only once the client reports what was paid.
        if (status.amountMinor && (status.currency === "CZK" || status.currency === "EUR")) {
          await this.tenantBilling.recordReferralPayment(tenantId, {
            amountMinor: status.amountMinor,
            currency: status.currency,
            longPeriod: status.longPeriod === true,
          });
        }
        return;
      case "FAILED":
      case "TIMEOUTED":
        await this.tenantBilling.updateSubscriptionStatus(tenantId, "past_due");
        return;
      case "CANCELED":
        await this.tenantBilling.updateSubscriptionStatus(tenantId, "canceled");
        await this.tenantBilling.voidReferralReward(tenantId, "canceled");
        return;
      case "REFUNDED":
      case "PARTIALLY_REFUNDED":
        await this.tenantBilling.voidReferralReward(tenantId, "refunded");
        return;
      default:
        this.logger.debug(
          `GoPay payment state ${status.state} recorded for tenant ${tenantId}; no tenant ` +
            "state change wired up for it",
        );
    }
  }
}
