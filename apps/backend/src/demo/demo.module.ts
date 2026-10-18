import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { DemoCleanupCron } from "./demo-cleanup.cron";
import { DemoSeedService } from "./demo-seed.service";
import { DemoTenantController } from "./demo-tenant.controller";
import { DemoTransferService } from "./demo-transfer.service";
import { DemoController } from "./demo.controller";
import { DemoService } from "./demo.service";

/** The public demo playground (docs/demo-playground-plan.md). */
@Module({
  imports: [InvoicesModule, ContactsModule],
  controllers: [DemoController, DemoTenantController],
  providers: [DemoService, DemoSeedService, DemoCleanupCron, DemoTransferService],
})
export class DemoModule {}
