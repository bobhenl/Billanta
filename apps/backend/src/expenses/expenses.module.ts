import { Module } from "@nestjs/common";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
  // EInvoicingModule books accepted e-invoices through the same create path.
  exports: [ExpensesService],
})
export class ExpensesModule {}
