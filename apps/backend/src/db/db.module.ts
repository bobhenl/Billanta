import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";

// @Global() because virtually every feature module needs DbService (either
// directly, or indirectly via TenantContextMiddleware) — avoids re-importing
// DbModule in every single feature module.
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
