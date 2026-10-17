import { Module } from "@nestjs/common";
import { AdminPartnersController } from "./admin-partners.controller";
import { PartnersService } from "./partners.service";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PublicPartnersController } from "./public-partners.controller";

@Module({
  controllers: [PublicPartnersController, AdminPartnersController],
  providers: [PartnersService, PlatformAdminGuard],
})
export class PartnersModule {}
