import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EetController } from "./eet.controller";
import { EetCron } from "./eet.cron";
import { EetService } from "./eet.service";

// No InvoicesModule import: InvoicesModule imports this one, because the
// "Mark as paid" route is what records a sale.
@Module({
  imports: [AuthModule],
  controllers: [EetController],
  providers: [EetService, EetCron],
  exports: [EetService],
})
export class EetModule {}
