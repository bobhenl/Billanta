import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { AuthModule } from "../auth/auth.module";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { SubscriptionActiveGuard } from "../billing/require-active-subscription.guard";
import { EmailModule } from "../email/email.module";
import { InvoiceRemindersCron } from "./invoice-reminders.cron";
import { InvoiceRemindersRepository } from "./invoice-reminders.repository";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";

@Module({
  // EmailModule: InvoicesService.sendInvoice and InvoiceRemindersCron both
  // need EmailService (invoice-emailing / overdue-payment-reminder feature).
  // AuthModule/ApiKeysModule: `CombinedAuthGuard` (public API, wired onto
  // `GET /v1/invoices` and `POST /v1/invoices/drafts` — see
  // invoices.controller.ts) needs both `JwtAuthGuard` (AuthModule) and
  // `ApiKeyAuthGuard` (ApiKeysModule) resolvable through THIS module's own
  // injector, the same reason SubscriptionActiveGuard is re-provided below
  // rather than assumed available globally.
  imports: [EmailModule, AuthModule, ApiKeysModule],
  controllers: [InvoicesController],
  // SubscriptionActiveGuard (blueprint §5 plan gating) is re-provided
  // directly here — rather than importing the whole BillingModule — since
  // it has no dependencies beyond the request object itself and
  // `@RequireActiveSubscription()` (used on InvoicesController.createDraft)
  // needs it resolvable via this module's own injector.
  //
  // InvoiceRemindersRepository/InvoiceRemindersCron: the daily overdue-
  // reminder digest (see invoice-reminders.cron.ts) — registered as
  // ordinary providers, not a controller; `@nestjs/schedule`'s discovery
  // service picks up the `@Cron`-decorated method regardless of which
  // module the provider lives in, as long as `ScheduleModule.forRoot()` is
  // imported somewhere in the app (see AppModule).
  providers: [
    InvoicesService,
    SubscriptionActiveGuard,
    InvoiceRemindersRepository,
    InvoiceRemindersCron,
    CombinedAuthGuard,
  ],
  // InvoicesService is consumed outside this module by
  // BankReconciliationModule (BankReconciliationService.markPaidFromReconciliation
  // — see bank-reconciliation.module.ts's doc comment for why it imports
  // this whole module rather than re-providing InvoicesService directly).
  exports: [InvoicesService],
})
export class InvoicesModule {}
