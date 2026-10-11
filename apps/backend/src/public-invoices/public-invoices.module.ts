import { Module } from "@nestjs/common";
import { PublicInvoicesController } from "./public-invoices.controller";
import { PublicInvoicesService } from "./public-invoices.service";

@Module({
  controllers: [PublicInvoicesController],
  providers: [PublicInvoicesService],
})
export class PublicInvoicesModule {}
