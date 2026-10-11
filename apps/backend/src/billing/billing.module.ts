import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { GopayClient } from "./gopay.client";
import { SubscriptionActiveGuard } from "./require-active-subscription.guard";
import { STRIPE_CLIENT, stripeClientFactory } from "./stripe-client.provider";
import { SubscriptionEventsRepository } from "./subscription-events.repository";
import { TenantBillingRepository } from "./tenant-billing.repository";

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    GopayClient,
    TenantBillingRepository,
    SubscriptionEventsRepository,
    SubscriptionActiveGuard,
    { provide: STRIPE_CLIENT, useFactory: stripeClientFactory, inject: [ConfigService] },
  ],
  // SubscriptionActiveGuard is also re-provided directly in InvoicesModule
  // (it has no dependencies of its own beyond the request object, so this
  // costs nothing) to avoid InvoicesModule needing a full import of
  // BillingModule just for one guard — exported here too in case another
  // module prefers importing BillingModule wholesale instead.
  exports: [SubscriptionActiveGuard],
})
export class BillingModule {}
