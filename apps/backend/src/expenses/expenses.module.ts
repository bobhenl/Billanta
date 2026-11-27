import { Module } from "@nestjs/common";
import { ExpenseAttachmentsService } from "./expense-attachments.service";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseAttachmentsService],
  // EInvoicingModule books accepted e-invoices through the same create path.
  exports: [ExpensesService],
})
export class ExpensesModule {}
