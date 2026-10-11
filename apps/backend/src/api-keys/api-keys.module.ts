import { Module } from "@nestjs/common";
import { ApiKeyAuthGuard } from "../auth/api-key-auth.guard";
import { TenantContextMiddleware } from "../tenancy/tenant-context.middleware";
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
 *
 * `TenantContextMiddleware` is ALSO listed here as a plain provider — not
 * because it's used as middleware from this module (it isn't; `AppModule`
 * applies it directly via `MiddlewareConsumer.apply()`, which resolves its
 * own constructor deps ad hoc and needs no provider registration), but
 * because `ApiKeyOrJwtTenantContextMiddleware` above injects it as an
 * ordinary constructor dependency (composition, not middleware chaining —
 * see that class's doc comment). Ordinary constructor injection requires an
 * actual registered provider token in the resolving module's container;
 * the ad-hoc instantiation Nest does for `MiddlewareConsumer.apply()`
 * targets does not also register the class as an injectable elsewhere.
 * Without this, Nest cannot resolve `ApiKeyOrJwtTenantContextMiddleware`'s
 * constructor at boot (`UnknownDependenciesException`). Safe to register
 * again here alongside the separate middleware-pipeline instance `AppModule`
 * creates: the class is stateless per-request (all state lives on `req`/the
 * transaction handle passed into `use()`), so two singleton instances behave
 * identically to one.
 */
@Module({
  controllers: [ApiKeysController],
  providers: [
    ApiKeysService,
    ApiKeyAuthGuard,
    TenantContextMiddleware,
    ApiKeyOrJwtTenantContextMiddleware,
  ],
  // TenantContextMiddleware is exported too: `consumer.apply()` in AppModule
  // instantiates ApiKeyOrJwtTenantContextMiddleware in AppModule's context,
  // so its constructor deps must be visible there, not only in this module.
  exports: [ApiKeysService, ApiKeyAuthGuard, TenantContextMiddleware, ApiKeyOrJwtTenantContextMiddleware],
})
export class ApiKeysModule {}
