import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { AuthModule } from "../auth/auth.module";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { SubscriptionActiveGuard } from "../billing/require-active-subscription.guard";
import { InvoicesModule } from "../invoices/invoices.module";
import { InvoiceTemplatesController } from "./invoice-templates.controller";
import { InvoiceTemplatesService } from "./invoice-templates.service";

@Module({
  imports: [InvoicesModule, AuthModule, ApiKeysModule],
  controllers: [InvoiceTemplatesController],
  providers: [InvoiceTemplatesService, CombinedAuthGuard, SubscriptionActiveGuard],
})
export class InvoiceTemplatesModule {}
