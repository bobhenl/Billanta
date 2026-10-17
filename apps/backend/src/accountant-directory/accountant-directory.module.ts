import { Module } from "@nestjs/common";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AccountantDirectoryService } from "./accountant-directory.service";
import { AccountantListingController } from "./accountant-listing.controller";
import { AdminAccountantsController, PublicAccountantsController } from "./public-accountants.controller";

@Module({
  controllers: [AccountantListingController, PublicAccountantsController, AdminAccountantsController],
  providers: [AccountantDirectoryService, PlatformAdminGuard],
})
export class AccountantDirectoryModule {}
