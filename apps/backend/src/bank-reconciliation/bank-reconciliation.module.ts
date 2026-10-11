import { Module } from "@nestjs/common";
import { InvoicesModule } from "../invoices/invoices.module";
import { BankReconciliationController } from "./bank-reconciliation.controller";
import { BankReconciliationService } from "./bank-reconciliation.service";

// Imports InvoicesModule (rather than re-providing InvoicesService directly,
// the way InvoicesModule itself re-provides SubscriptionActiveGuard) since
// BankReconciliationService needs the real InvoicesService instance —
// specifically `markPaidFromReconciliation` — not just its shape.
@Module({
  imports: [InvoicesModule],
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService],
})
export class BankReconciliationModule {}
