import { Module } from "@nestjs/common";
import { InvoicePartnerSharesController, NetIncomeController, TaxModelController } from "./net-income.controller";
import { NetIncomeService } from "./net-income.service";

@Module({
  controllers: [NetIncomeController, TaxModelController, InvoicePartnerSharesController],
  providers: [NetIncomeService],
})
export class NetIncomeModule {}
