import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { WelcomeTrialService } from "./welcome-trial.service";

// Apart from BillingModule so settings and the invoice import can start the
// trial without pulling in Stripe and GoPay. ContactsModule checks the IČO in ARES / RPO.
@Module({
  imports: [ContactsModule],
  providers: [WelcomeTrialService],
  exports: [WelcomeTrialService],
})
export class WelcomeTrialModule {}
