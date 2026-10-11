import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { ContactsModule } from "../contacts/contacts.module";
import { InvoicePdfService } from "../invoices/invoice-pdf.service";
import { GuestInvoicesController } from "./guest-invoices.controller";
import { GuestInvoicesService } from "./guest-invoices.service";

@Module({
  imports: [AiModule, ContactsModule],
  controllers: [GuestInvoicesController],
  providers: [GuestInvoicesService, InvoicePdfService],
})
export class GuestInvoicesModule {}
