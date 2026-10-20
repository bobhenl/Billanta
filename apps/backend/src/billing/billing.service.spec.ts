import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingService, mapStripeSubscriptionStatus } from "./billing.service";
import type { GopayClient } from "./gopay.client";
import type { SubscriptionEventsRepository } from "./subscription-events.repository";
import type { TenantBillingRepository } from "./tenant-billing.repository";

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

type MockStripeClient = { webhooks: { constructEvent: ReturnType<typeof vi.fn> } };
type MockTenantBilling = {
  findTenantIdByStripeCustomerId: ReturnType<typeof vi.fn>;
  findTenantIdByGopayPayerId: ReturnType<typeof vi.fn>;
  updateSubscriptionStatus: ReturnType<typeof vi.fn>;
  clearPastDue: ReturnType<typeof vi.fn>;
  recordReferralPayment: ReturnType<typeof vi.fn>;
  voidReferralReward: ReturnType<typeof vi.fn>;
};
type MockSubscriptionEvents = {
  insertIfNew: ReturnType<typeof vi.fn>;
  markProcessed: ReturnType<typeof vi.fn>;
};
type MockGopayClient = { getPaymentStatus: ReturnType<typeof vi.fn> };

describe("BillingService", () => {
  let stripe: MockStripeClient;
  let gopayClient: MockGopayClient;
  let tenantBilling: MockTenantBilling;
  let subscriptionEvents: MockSubscriptionEvents;
  let service: BillingService;

  beforeEach(() => {
    stripe = { webhooks: { constructEvent: vi.fn() } };
    gopayClient = { getPaymentStatus: vi.fn() };
    tenantBilling = {
      findTenantIdByStripeCustomerId: vi.fn(),
      findTenantIdByGopayPayerId: vi.fn(),
      updateSubscriptionStatus: vi.fn().mockResolvedValue(undefined),
      clearPastDue: vi.fn().mockResolvedValue(undefined),
      recordReferralPayment: vi.fn().mockResolvedValue(0),
      voidReferralReward: vi.fn().mockResolvedValue(false),
    };
    subscriptionEvents = {
      insertIfNew: vi.fn(),
      markProcessed: vi.fn().mockResolvedValue(undefined),
    };

    service = new BillingService(
      makeConfig({ STRIPE_WEBHOOK_SECRET: "whsec_test" }),
      stripe as unknown as Stripe,
      gopayClient as unknown as GopayClient,
      tenantBilling as unknown as TenantBillingRepository,
      subscriptionEvents as unknown as SubscriptionEventsRepository,
    );
  });

  describe("Stripe — signature verification", () => {
    it("rejects an invalid signature with 400 and never touches the DB", async () => {
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("No signatures found matching the expected signature for payload");
      });

      await expect(
        service.handleStripeWebhook(Buffer.from("{}"), "bad-signature"),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tenantBilling.findTenantIdByStripeCustomerId).not.toHaveBeenCalled();
      expect(subscriptionEvents.insertIfNew).not.toHaveBeenCalled();
    });

    it("rejects a missing raw body with 400 without ever calling Stripe's SDK", async () => {
      await expect(service.handleStripeWebhook(undefined, "sig")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
    });

    it("rejects a missing Stripe-Signature header with 400", async () => {
      await expect(
        service.handleStripeWebhook(Buffer.from("{}"), undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
    });

    it("calls constructEvent with the exact raw buffer, header, and configured secret", async () => {
      const rawBody = Buffer.from('{"id":"evt_1"}');
      stripe.webhooks.constructEvent.mockReturnValue({
        id: "evt_1",
        type: "invoice.paid",
        data: { object: { customer: "cus_1" } },
      });
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue("tenant-1");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(rawBody, "t=1,v1=abc");

      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
        rawBody,
        "t=1,v1=abc",
        "whsec_test",
      );
    });
  });

  describe("Stripe — idempotency", () => {
    it("skips processing entirely on a replayed event id", async () => {
      const event = {
        id: "evt_dup",
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_123" } },
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue("tenant-1");
      subscriptionEvents.insertIfNew.mockResolvedValue(false); // already recorded

      const result = await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(result).toEqual({ received: true, skipped: "duplicate" });
      expect(tenantBilling.updateSubscriptionStatus).not.toHaveBeenCalled();
      expect(subscriptionEvents.markProcessed).not.toHaveBeenCalled();
    });

    it("processes and marks-processed a genuinely new event exactly once", async () => {
      const event = {
        id: "evt_new",
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_123" } },
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue("tenant-1");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      const result = await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(subscriptionEvents.insertIfNew).toHaveBeenCalledWith(
        "tenant-1",
        "stripe",
        "evt_new",
        "invoice.payment_failed",
        event.data.object,
      );
      expect(tenantBilling.updateSubscriptionStatus).toHaveBeenCalledWith("tenant-1", "past_due");
      expect(subscriptionEvents.markProcessed).toHaveBeenCalledWith("tenant-1", "stripe", "evt_new");
      expect(result).toEqual({ received: true });
    });
  });

  describe("Stripe — event handling", () => {
    it("checkout.session.completed activates the tenant from metadata and stores the customer id", async () => {
      const event = {
        id: "evt_checkout",
        type: "checkout.session.completed",
        data: {
          object: { customer: "cus_new", metadata: { tenantId: "tenant-42" } },
        },
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      // Resolved from metadata directly — no customer-id lookup needed/possible yet.
      expect(tenantBilling.findTenantIdByStripeCustomerId).not.toHaveBeenCalled();
      expect(tenantBilling.updateSubscriptionStatus).toHaveBeenCalledWith("tenant-42", "active", {
        stripeCustomerId: "cus_new",
      });
    });

    it("checkout.session.completed stores the plan and interval from our own Checkout metadata", async () => {
      stripe.webhooks.constructEvent.mockReturnValue({
        id: "evt_checkout_plan",
        type: "checkout.session.completed",
        data: { object: { customer: "cus_p", metadata: { tenantId: "tenant-7", plan: "plus", interval: "year" } } },
      });
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(tenantBilling.updateSubscriptionStatus).toHaveBeenCalledWith("tenant-7", "active", {
        stripeCustomerId: "cus_p",
        subscriptionPlan: "plus",
        subscriptionInterval: "year",
      });
    });

    it("checkout.session.completed ignores a plan key it doesn't know", async () => {
      stripe.webhooks.constructEvent.mockReturnValue({
        id: "evt_checkout_bad",
        type: "checkout.session.completed",
        data: { object: { customer: "cus_q", metadata: { tenantId: "tenant-8", plan: "gold", interval: "week" } } },
      });
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(tenantBilling.updateSubscriptionStatus).toHaveBeenCalledWith("tenant-8", "active", { stripeCustomerId: "cus_q" });
    });

    it("customer.subscription.deleted downgrades the tenant to canceled", async () => {
      const event = {
        id: "evt_del",
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_1" } },
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue("tenant-1");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(tenantBilling.updateSubscriptionStatus).toHaveBeenCalledWith("tenant-1", "canceled", {
        stripeSubscriptionId: null,
        subscriptionCancelAt: null,
      });
    });

    it("invoice.paid clears past_due via clearPastDue (not a blind set to active)", async () => {
      const event = {
        id: "evt_paid",
        type: "invoice.paid",
        data: { object: { customer: "cus_1" } },
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue("tenant-1");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(tenantBilling.clearPastDue).toHaveBeenCalledWith("tenant-1");
      expect(tenantBilling.updateSubscriptionStatus).not.toHaveBeenCalled();
      // No billing reason: not a plan period, so no referral payment.
      expect(tenantBilling.recordReferralPayment).not.toHaveBeenCalled();
    });

    it("invoice.paid for a plan period records a referral payment without VAT", async () => {
      const start = 1_790_000_000;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: "evt_paid_ref",
        type: "invoice.paid",
        data: {
          object: {
            customer: "cus_1",
            billing_reason: "subscription_cycle",
            currency: "czk",
            amount_paid: 34_969,
            total_excluding_tax: 28_900,
            lines: { data: [{ period: { start, end: start + 365 * 86_400 } }] },
          },
        },
      });
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue("tenant-1");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(tenantBilling.recordReferralPayment).toHaveBeenCalledWith("tenant-1", {
        amountMinor: 28_900,
        currency: "CZK",
        longPeriod: true,
      });
    });

    it("charge.refunded voids a held-back referral reward", async () => {
      stripe.webhooks.constructEvent.mockReturnValue({
        id: "evt_refund",
        type: "charge.refunded",
        data: { object: { customer: "cus_1" } },
      });
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue("tenant-1");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(tenantBilling.voidReferralReward).toHaveBeenCalledWith("tenant-1", "refunded");
    });

    it("customer.subscription.deleted voids a held-back referral reward", async () => {
      stripe.webhooks.constructEvent.mockReturnValue({
        id: "evt_del_ref",
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_1" } },
      });
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue("tenant-1");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(tenantBilling.voidReferralReward).toHaveBeenCalledWith("tenant-1", "canceled");
    });

    it("returns skipped=tenant-not-resolved and never inserts an event when no tenant can be found", async () => {
      const event = {
        id: "evt_orphan",
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_unknown" } },
      };
      stripe.webhooks.constructEvent.mockReturnValue(event);
      tenantBilling.findTenantIdByStripeCustomerId.mockResolvedValue(null);

      const result = await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(result).toEqual({ received: true, skipped: "tenant-not-resolved" });
      expect(subscriptionEvents.insertIfNew).not.toHaveBeenCalled();
    });
  });

  describe("mapStripeSubscriptionStatus", () => {
    it.each([
      ["trialing", "trialing"],
      ["active", "active"],
      ["past_due", "past_due"],
      ["unpaid", "past_due"],
      ["incomplete", "past_due"],
      ["canceled", "canceled"],
      ["incomplete_expired", "canceled"],
      ["paused", "canceled"],
    ] as const)("maps Stripe status %s -> %s", (stripeStatus, expected) => {
      expect(mapStripeSubscriptionStatus(stripeStatus)).toBe(expected);
    });
  });

  describe("GoPay webhook", () => {
    it("rejects a notification with no payment id at all", async () => {
      await expect(service.handleGopayWebhook(undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(gopayClient.getPaymentStatus).not.toHaveBeenCalled();
    });

    it("never trusts the notification directly — always calls back GopayClient for status", async () => {
      gopayClient.getPaymentStatus.mockResolvedValue({
        id: "pay-1",
        state: "PAID",
        payerId: "payer-1",
      });
      tenantBilling.findTenantIdByGopayPayerId.mockResolvedValue("tenant-9");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleGopayWebhook("pay-1");

      expect(gopayClient.getPaymentStatus).toHaveBeenCalledWith("pay-1");
    });

    it("skips when the status has no payer id to resolve a tenant with", async () => {
      gopayClient.getPaymentStatus.mockResolvedValue({ id: "pay-2", state: "PAID", payerId: null });

      const result = await service.handleGopayWebhook("pay-2");

      expect(result).toEqual({ received: true, skipped: "tenant-not-resolved" });
      expect(subscriptionEvents.insertIfNew).not.toHaveBeenCalled();
    });

    it("skips a duplicate GoPay notification (idempotency)", async () => {
      gopayClient.getPaymentStatus.mockResolvedValue({
        id: "pay-3",
        state: "PAID",
        payerId: "payer-1",
      });
      tenantBilling.findTenantIdByGopayPayerId.mockResolvedValue("tenant-9");
      subscriptionEvents.insertIfNew.mockResolvedValue(false);

      const result = await service.handleGopayWebhook("pay-3");

      expect(result).toEqual({ received: true, skipped: "duplicate" });
      expect(tenantBilling.updateSubscriptionStatus).not.toHaveBeenCalled();
    });

    it("activates the tenant on a new PAID notification and marks the event processed", async () => {
      gopayClient.getPaymentStatus.mockResolvedValue({
        id: "pay-4",
        state: "PAID",
        payerId: "payer-1",
      });
      tenantBilling.findTenantIdByGopayPayerId.mockResolvedValue("tenant-9");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleGopayWebhook("pay-4");

      expect(tenantBilling.updateSubscriptionStatus).toHaveBeenCalledWith("tenant-9", "active");
      expect(subscriptionEvents.markProcessed).toHaveBeenCalledWith("tenant-9", "gopay", "pay-4");
    });

    it("marks a tenant past_due on a FAILED GoPay status", async () => {
      gopayClient.getPaymentStatus.mockResolvedValue({
        id: "pay-5",
        state: "FAILED",
        payerId: "payer-1",
      });
      tenantBilling.findTenantIdByGopayPayerId.mockResolvedValue("tenant-9");
      subscriptionEvents.insertIfNew.mockResolvedValue(true);

      await service.handleGopayWebhook("pay-5");

      expect(tenantBilling.updateSubscriptionStatus).toHaveBeenCalledWith("tenant-9", "past_due");
    });
  });
});
