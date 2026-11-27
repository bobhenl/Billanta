import { Module } from "@nestjs/common";
import { BankReconciliationModule } from "../bank-reconciliation/bank-reconciliation.module";
import { ContactsModule } from "../contacts/contacts.module";
import { DashboardModule } from "../dashboard/dashboard.module";
import { ExpensesModule } from "../expenses/expenses.module";
import { InvoiceTemplatesModule } from "../invoice-templates/invoice-templates.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { TenantsModule } from "../tenants/tenants.module";
import { McpController } from "./mcp.controller";

/** The tools call the same services as the REST controllers, so the rules stay in one place. */
@Module({
  imports: [TenantsModule, InvoicesModule, ContactsModule, ExpensesModule, BankReconciliationModule, InvoiceTemplatesModule, DashboardModule],
  controllers: [McpController],
})
export class McpModule {}
