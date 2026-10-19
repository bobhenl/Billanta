import { Module } from "@nestjs/common";
import { ReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";

@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService],
  // Promo codes with a referrer claim the referral through it.
  exports: [ReferralsService],
})
export class ReferralsModule {}
