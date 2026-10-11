import { Module } from "@nestjs/common";
import Stripe from "stripe";
import { AuthModule } from "../auth/auth.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { CardPaymentsSettingsController, PublicCardPaymentsController } from "./card-payments.controller";
import { CardPaymentsCron } from "./card-payments.cron";
import { CardPaymentsService, STRIPE_FACTORY, type StripeFactory } from "./card-payments.service";

@Module({
  imports: [InvoicesModule, AuthModule],
  controllers: [CardPaymentsSettingsController, PublicCardPaymentsController],
  providers: [
    CardPaymentsService,
    CardPaymentsCron,
    { provide: STRIPE_FACTORY, useValue: ((key: string) => new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 })) satisfies StripeFactory },
  ],
  exports: [CardPaymentsService],
})
export class CardPaymentsModule {}
