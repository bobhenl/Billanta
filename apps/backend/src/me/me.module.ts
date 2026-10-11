import { Module } from "@nestjs/common";
import { MeController } from "./me.controller";
import { AccountDeletionService } from "./account-deletion.service";
import { MeService } from "./me.service";

@Module({
  controllers: [MeController],
  providers: [MeService, AccountDeletionService],
})
export class MeModule {}
