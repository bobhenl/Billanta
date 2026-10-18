import { Module } from "@nestjs/common";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { ReferralsModule } from "../referrals/referrals.module";
import { AdminPromoCodesController } from "./admin-promo-codes.controller";
import { PromoCodesController } from "./promo-codes.controller";
import { PromoCodesService } from "./promo-codes.service";
import { PublicPromoCodesController } from "./public-promo-codes.controller";

@Module({
  imports: [ReferralsModule],
  controllers: [PromoCodesController, PublicPromoCodesController, AdminPromoCodesController],
  providers: [PromoCodesService, PlatformAdminGuard],
  // Other kinds of code (class codes) register a PromoKindHandler on it.
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
