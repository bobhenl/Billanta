import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { AuthModule } from "../auth/auth.module";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { ContactsModule } from "../contacts/contacts.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  // Auth + ApiKeys: CombinedAuthGuard (JWT or sk_live_ key), as in InvoicesModule.
  imports: [ContactsModule, AuthModule, ApiKeysModule],
  controllers: [AiController],
  providers: [AiService, CombinedAuthGuard],
  // GuestInvoicesModule: AI fill on the public "invoice without an account" page.
  exports: [AiService],
})
export class AiModule {}
