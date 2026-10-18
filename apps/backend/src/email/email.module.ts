import { Module } from "@nestjs/common";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AdminEmailOutboxController, EmailUnsubscribeController, ResendWebhookController } from "./email-public.controller";
import { EmailOutboxService } from "./email-outbox.service";
import { EmailOutboxWorker } from "./email-outbox.worker";
import { EmailUnsubscribeService } from "./email-unsubscribe.service";
import { EmailService } from "./email.service";
import { WeeklyDigestCron } from "./weekly-digest.cron";

/**
 * Everything e-mail: rendering (`EmailService`), the outbox and its worker,
 * unsubscribe links, the Resend webhook and the weekly digest. Kept separate
 * from `InvoicesModule` so any module can import it without pulling in
 * invoices-specific providers. None of its controllers are tenant-scoped
 * (public token, webhook, platform admin), so none go on the tenant
 * middleware in `app.module.ts`.
 */
@Module({
  controllers: [EmailUnsubscribeController, ResendWebhookController, AdminEmailOutboxController],
  providers: [EmailService, EmailOutboxService, EmailOutboxWorker, EmailUnsubscribeService, WeeklyDigestCron, PlatformAdminGuard],
  exports: [EmailService, EmailOutboxService],
})
export class EmailModule {}
