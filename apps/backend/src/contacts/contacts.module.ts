import { Module } from "@nestjs/common";
import { CompanyLookupPublicController } from "./company-lookup-public.controller";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";

@Module({
  // The public lookup has no tenant middleware; it only reads public registers.
  controllers: [ContactsController, CompanyLookupPublicController],
  providers: [ContactsService],
  // AiModule matches AI-suggested customers against contacts and ARES.
  exports: [ContactsService],
})
export class ContactsModule {}
