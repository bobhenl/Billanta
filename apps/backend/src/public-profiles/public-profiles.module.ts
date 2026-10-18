import { Module } from "@nestjs/common";
import { PublicAccountantsController } from "./public-accountants.controller";
import { PublicProfilesController } from "./public-profiles.controller";
import { PublicProfilesService } from "./public-profiles.service";

@Module({
  controllers: [PublicProfilesController, PublicAccountantsController],
  providers: [PublicProfilesService],
})
export class PublicProfilesModule {}
