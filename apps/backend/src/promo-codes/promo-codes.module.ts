import { Module } from "@nestjs/common";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AdminPromoCodesController } from "./admin-promo-codes.controller";
import { PromoCodesController } from "./promo-codes.controller";
import { PromoCodesService } from "./promo-codes.service";

@Module({
  controllers: [PromoCodesController, AdminPromoCodesController],
  providers: [PromoCodesService, PlatformAdminGuard],
})
export class PromoCodesModule {}
