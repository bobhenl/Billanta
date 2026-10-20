import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { ProfileMessagesController } from "./profile-messages.controller";
import { ProfileMessagesService } from "./profile-messages.service";
import { ProfileOrdersController } from "./profile-orders.controller";
import { ProfileOrdersService } from "./profile-orders.service";
import { PublicDirectoryController } from "./public-directory.controller";
import { PublicDirectoryService } from "./public-directory.service";
import { PublicProfilesController } from "./public-profiles.controller";
import { PublicProfilesService } from "./public-profiles.service";

@Module({
  // InvoicesModule for BuyerDetailsService (contact matching, tenant transaction), ContactsModule for the ARES lookup.
  imports: [InvoicesModule, ContactsModule],
  controllers: [PublicProfilesController, ProfileOrdersController, ProfileMessagesController, PublicDirectoryController],
  providers: [PublicProfilesService, ProfileOrdersService, ProfileMessagesService, PublicDirectoryService],
})
export class PublicProfilesModule {}
