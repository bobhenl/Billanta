import { Module } from "@nestjs/common";
import { PublicProfilesController } from "./public-profiles.controller";
import { PublicProfilesService } from "./public-profiles.service";

@Module({
  controllers: [PublicProfilesController],
  providers: [PublicProfilesService],
})
export class PublicProfilesModule {}
