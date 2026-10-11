import { Global, Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

// @Global() so any feature (invoices, bank, team, portal…) can inject
// NotificationsService without import wiring.
@Global()
@Module({
  imports: [EmailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
