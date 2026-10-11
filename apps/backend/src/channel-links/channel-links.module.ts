import { Module } from "@nestjs/common";
import { ChannelLinksController } from "./channel-links.controller";
import { ChannelLinksService } from "./channel-links.service";

@Module({
  controllers: [ChannelLinksController],
  providers: [ChannelLinksService],
})
export class ChannelLinksModule {}
