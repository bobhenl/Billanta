import { Module } from "@nestjs/common";
import { WelcomeTrialModule } from "../billing/welcome-trial.module";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";

@Module({
  // A saved IČO can start the welcome trial.
  imports: [WelcomeTrialModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
