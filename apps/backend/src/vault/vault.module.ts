import { Module } from "@nestjs/common";
import { VaultController } from "./vault.controller";
import { VaultDemoController } from "./vault-demo.controller";
import { VaultService } from "./vault.service";

@Module({
  controllers: [VaultController, VaultDemoController],
  providers: [VaultService],
})
export class VaultModule {}
