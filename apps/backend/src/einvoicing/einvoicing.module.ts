import { Module } from "@nestjs/common";
import { ExpensesModule } from "../expenses/expenses.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { createEInvoiceProvider, einvoicingEnabled } from "./einvoicing-config";
import { EInvoicingSettingsController, EInvoicingWebhookController, IncomingEInvoicesController, InvoiceEInvoiceController } from "./einvoicing.controller";
import { EINVOICE_PROVIDER, EInvoicingService } from "./einvoicing.service";

@Module({
  imports: [InvoicesModule, ExpensesModule],
  controllers: [InvoiceEInvoiceController, IncomingEInvoicesController, EInvoicingSettingsController, EInvoicingWebhookController],
  providers: [
    // Built only when enabled, so a misconfigured provider can't break boot while the feature is off.
    { provide: EINVOICE_PROVIDER, useFactory: () => (einvoicingEnabled() ? createEInvoiceProvider() : null) },
    EInvoicingService,
  ],
  exports: [EInvoicingService],
})
export class EInvoicingModule {}
