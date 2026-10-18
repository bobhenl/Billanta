import { Module } from "@nestjs/common";
import { InvoicesModule } from "../invoices/invoices.module";
import { DemoCleanupCron } from "./demo-cleanup.cron";
import { DemoSeedService } from "./demo-seed.service";
import { DemoController } from "./demo.controller";
import { DemoService } from "./demo.service";

/** The public demo playground (docs/demo-playground-plan.md). */
@Module({
  imports: [InvoicesModule],
  controllers: [DemoController],
  providers: [DemoService, DemoSeedService, DemoCleanupCron],
})
export class DemoModule {}
