import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { AuthModule } from "../auth/auth.module";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { SubscriptionActiveGuard } from "../billing/require-active-subscription.guard";
import { InvoicesModule } from "../invoices/invoices.module";
import { TimeTrackingController } from "./time-tracking.controller";
import { TimeTrackingService } from "./time-tracking.service";

@Module({
  imports: [InvoicesModule, AuthModule, ApiKeysModule],
  controllers: [TimeTrackingController],
  providers: [TimeTrackingService, CombinedAuthGuard, SubscriptionActiveGuard],
})
export class TimeTrackingModule {}
