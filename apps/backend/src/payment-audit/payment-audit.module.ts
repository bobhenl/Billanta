import { Module } from "@nestjs/common";
import { PaymentAuditController } from "./payment-audit.controller";
import { PaymentAuditService } from "./payment-audit.service";

@Module({
  controllers: [PaymentAuditController],
  providers: [PaymentAuditService],
})
export class PaymentAuditModule {}
