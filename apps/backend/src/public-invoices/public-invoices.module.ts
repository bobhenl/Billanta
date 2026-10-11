import { Module } from "@nestjs/common";
import { PublicInvoicesController } from "./public-invoices.controller";
import { PublicInvoicesService } from "./public-invoices.service";
import { EmailModule } from "../email/email.module";
import { ClientPortalController } from "./client-portal.controller";
import { ClientPortalService } from "./client-portal.service";

@Module({
  imports: [EmailModule],
  controllers: [PublicInvoicesController, ClientPortalController],
  providers: [PublicInvoicesService, ClientPortalService],
})
export class PublicInvoicesModule {}
