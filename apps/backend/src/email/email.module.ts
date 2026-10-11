import { Module } from "@nestjs/common";
import { EmailService } from "./email.service";

/**
 * Thin module wrapping `EmailService` (invoice-emailing / overdue-payment-
 * reminder feature — see `email.service.ts`'s doc comment). Kept separate
 * from `InvoicesModule` so any future module (e.g. a welcome email on
 * tenant signup) can import it too without pulling in invoices-specific
 * providers.
 */
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
