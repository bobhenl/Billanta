import { Module } from "@nestjs/common";
import { ExpensesModule } from "../expenses/expenses.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { BankConnectionsController } from "./bank-connections.controller";
import { BankConnectionsService } from "./bank-connections.service";
import { BankReconciliationController } from "./bank-reconciliation.controller";
import { BankReconciliationService } from "./bank-reconciliation.service";
import { BankRulesController } from "./bank-rules.controller";
import { BankRulesService } from "./bank-rules.service";
import { BankSyncCron } from "./bank-sync.cron";

// Imports InvoicesModule (rather than re-providing InvoicesService directly,
// the way InvoicesModule itself re-provides SubscriptionActiveGuard) since
// BankReconciliationService needs the real InvoicesService instance —
// specifically `markPaidFromReconciliation` — not just its shape.
// ExpensesModule: a bank rule can turn an outgoing payment into an expense draft.
@Module({
  imports: [InvoicesModule, ExpensesModule],
  controllers: [BankReconciliationController, BankConnectionsController, BankRulesController],
  providers: [BankReconciliationService, BankConnectionsService, BankRulesService, BankSyncCron],
})
export class BankReconciliationModule {}
