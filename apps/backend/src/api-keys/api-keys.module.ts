import { Module } from "@nestjs/common";
import { ApiKeyAuthGuard } from "../auth/api-key-auth.guard";
import { ApiKeyOrJwtTenantContextMiddleware } from "./api-key-or-jwt-tenant-context.middleware";
import { ApiKeysController } from "./api-keys.controller";
import { ApiKeysService } from "./api-keys.service";

/**
 * `ApiKeyAuthGuard` and `ApiKeyOrJwtTenantContextMiddleware` are exported
 * (not just the service) so `InvoicesModule` (for the guard) and
 * `AppModule` (for the middleware, via `MiddlewareConsumer` in
 * `configure()`) can resolve them through Nest's DI once this module is
 * imported, rather than each needing to re-declare `ApiKeysService` as its
 * own provider — mirrors how `InvoicesModule` already re-provides
 * `SubscriptionActiveGuard` directly.
 */
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyAuthGuard, ApiKeyOrJwtTenantContextMiddleware],
  exports: [ApiKeysService, ApiKeyAuthGuard, ApiKeyOrJwtTenantContextMiddleware],
})
export class ApiKeysModule {}
