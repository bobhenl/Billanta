import { Module } from "@nestjs/common";
import { DashboardModule } from "../dashboard/dashboard.module";
import { EmailModule } from "../email/email.module";
import { FormSchemasModule } from "../form-schemas/form-schemas.module";
import { ExportsController } from "./exports.controller";
import { ExportsService } from "./exports.service";
import { VatFilingRemindersCron } from "./vat-filing-reminders.cron";

@Module({
  imports: [EmailModule, DashboardModule, FormSchemasModule],
  controllers: [ExportsController],
  providers: [ExportsService, VatFilingRemindersCron],
})
export class ExportsModule {}
