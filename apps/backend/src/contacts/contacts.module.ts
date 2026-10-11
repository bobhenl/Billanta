import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";

@Module({
  controllers: [ContactsController],
  providers: [ContactsService],
  // AiModule matches AI-suggested customers against contacts and ARES.
  exports: [ContactsService],
})
export class ContactsModule {}
