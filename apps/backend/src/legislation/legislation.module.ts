import { Module } from "@nestjs/common";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AdminLegislationController } from "./admin-legislation.controller";
import { LegislationCron } from "./legislation.cron";
import { LegislationService } from "./legislation.service";
import { PublicLegislationController } from "./public-legislation.controller";

@Module({
  controllers: [AdminLegislationController, PublicLegislationController],
  providers: [LegislationService, LegislationCron, PlatformAdminGuard],
})
export class LegislationModule {}
