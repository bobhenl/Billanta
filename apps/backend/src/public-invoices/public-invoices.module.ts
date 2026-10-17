import { Module } from "@nestjs/common";
import { PublicInvoicesController } from "./public-invoices.controller";
import { PublicInvoicesService } from "./public-invoices.service";
import { EmailModule } from "../email/email.module";
import { ClientPortalController } from "./client-portal.controller";
import { ClientPortalService } from "./client-portal.service";
import { BuyerDetailsPublicController } from "./buyer-details-public.controller";
import { InvoicesModule } from "../invoices/invoices.module";
import { ContactsModule } from "../contacts/contacts.module";

@Module({
  imports: [EmailModule, InvoicesModule, ContactsModule],
  controllers: [PublicInvoicesController, ClientPortalController, BuyerDetailsPublicController],
  providers: [PublicInvoicesService, ClientPortalService],
})
export class PublicInvoicesModule {}
