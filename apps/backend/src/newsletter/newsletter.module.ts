import { Module } from "@nestjs/common";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AdminNewsletterController, MeNewsletterController, PublicNewsletterController } from "./newsletter.controller";
import { NewsletterCron } from "./newsletter.cron";
import { NewsletterService } from "./newsletter.service";

@Module({
  controllers: [PublicNewsletterController, MeNewsletterController, AdminNewsletterController],
  providers: [NewsletterService, NewsletterCron, PlatformAdminGuard],
})
export class NewsletterModule {}
