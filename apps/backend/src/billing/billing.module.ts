import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AdminBillingController, AdminBillingService } from "./admin-billing.controller";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { GopayClient } from "./gopay.client";
import { SubscriptionActiveGuard } from "./require-active-subscription.guard";
import { STRIPE_CLIENT, stripeClientFactory } from "./stripe-client.provider";
import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "./subscription.service";
import { SubscriptionEventsRepository } from "./subscription-events.repository";
import { TenantBillingRepository } from "./tenant-billing.repository";
import { TrialRemindersCron } from "./trial-reminders.cron";

@Module({
  controllers: [BillingController, SubscriptionController, AdminBillingController],
  providers: [
    BillingService,
    GopayClient,
    TenantBillingRepository,
    SubscriptionEventsRepository,
    SubscriptionActiveGuard,
    SubscriptionService,
    AdminBillingService,
    PlatformAdminGuard,
    TrialRemindersCron,
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
