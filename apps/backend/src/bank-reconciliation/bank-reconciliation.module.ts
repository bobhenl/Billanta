import { Module } from "@nestjs/common";
import { InvoicesModule } from "../invoices/invoices.module";
import { BankConnectionsController } from "./bank-connections.controller";
import { BankConnectionsService } from "./bank-connections.service";
import { BankReconciliationController } from "./bank-reconciliation.controller";
import { BankReconciliationService } from "./bank-reconciliation.service";
import { BankSyncCron } from "./bank-sync.cron";

// Imports InvoicesModule (rather than re-providing InvoicesService directly,
// the way InvoicesModule itself re-provides SubscriptionActiveGuard) since
// BankReconciliationService needs the real InvoicesService instance —
// specifically `markPaidFromReconciliation` — not just its shape.
@Module({
  imports: [InvoicesModule],
  controllers: [BankReconciliationController, BankConnectionsController],
  providers: [BankReconciliationService, BankConnectionsService, BankSyncCron],
})
export class BankReconciliationModule {}
