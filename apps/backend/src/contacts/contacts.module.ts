import { Module } from "@nestjs/common";
import { CompanyLookupPublicController } from "./company-lookup-public.controller";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";
import { SkCompaniesCron } from "./sk-companies/sk-companies.cron";
import { SkCompaniesService } from "./sk-companies/sk-companies.service";

@Module({
  // The public lookup has no tenant middleware; it only reads public registers.
  controllers: [ContactsController, CompanyLookupPublicController],
  // SkCompanies*: the local copy of the Slovak register behind the SK typeahead.
  providers: [ContactsService, SkCompaniesService, SkCompaniesCron],
  // AiModule matches AI-suggested customers against contacts and ARES.
  exports: [ContactsService],
})
export class ContactsModule {}
