import { Global, Module } from "@nestjs/common";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

// @Global() so every feature can inject AuditService without import wiring.
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
