import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  // The VAT filing reminder reads its activity scan (src/exports/vat-filing-reminders.cron.ts).
  exports: [DashboardService],
})
export class DashboardModule {}
