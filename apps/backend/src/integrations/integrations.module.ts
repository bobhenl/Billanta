import { Module } from "@nestjs/common";
import { FeedsController } from "./feeds.controller";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";

@Module({
  controllers: [IntegrationsController, FeedsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
