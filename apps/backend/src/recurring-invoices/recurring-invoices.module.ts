import { Module } from "@nestjs/common";
import { RecurringInvoiceGenerationService } from "./recurring-invoice-generation.service";
import { RecurringInvoicesController } from "./recurring-invoices.controller";
import { RecurringInvoicesService } from "./recurring-invoices.service";

@Module({
  controllers: [RecurringInvoicesController],
  // RecurringInvoiceGenerationService's `@Cron` handler is only ever
  // triggered by Nest's scheduler (registered globally via
  // `ScheduleModule.forRoot()` in AppModule) — it needs no controller of
  // its own and is never injected elsewhere, but is still provided here so
  // Nest instantiates it (and therefore registers the cron job) at all.
  providers: [RecurringInvoicesService, RecurringInvoiceGenerationService],
})
export class RecurringInvoicesModule {}
