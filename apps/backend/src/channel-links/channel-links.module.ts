import { Module } from "@nestjs/common";
import { ChannelLinksController, ChannelLinksServiceController } from "./channel-links.controller";
import { ChannelLinksService } from "./channel-links.service";

@Module({
  controllers: [ChannelLinksServiceController, ChannelLinksController],
  providers: [ChannelLinksService],
})
export class ChannelLinksModule {}
