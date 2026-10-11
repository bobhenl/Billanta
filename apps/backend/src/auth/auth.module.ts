import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * Owns JWT verification for the whole app (blueprint §2/§4).
 *
 * `JwtModule.registerAsync({ global: true, ... })` makes `JwtService`
 * injectable anywhere in the app — including `TenantContextMiddleware`
 * (`src/tenancy/tenant-context.middleware.ts`), which is not declared as a
 * provider of any module and is resolved by Nest via `AppModule`'s own
 * container when `MiddlewareConsumer.apply(...)` runs. That's the same
 * mechanism that already lets it inject the `@Global()` `DbService` today;
 * marking this module's `JwtModule` global keeps `JwtService` resolvable the
 * same way, without every feature module needing to import `AuthModule`
 * individually.
 *
 * Only ONE secret (`JWT_SECRET`) is configured here — the short-lived HS256
 * token minted by the frontend (`apps/frontend/lib/backend-token.ts`) for
 * calling this API. This is deliberately NOT the same secret/mechanism as
 * NextAuth's own session cookies (`NEXTAUTH_SECRET`) — see the blueprint
 * note on `apps/frontend/auth.ts` for why the two are kept separate.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("JWT_SECRET");
        if (!secret) {
          throw new Error("JWT_SECRET is not set — see .env.example");
        }
        return {
          secret,
          signOptions: { algorithm: "HS256" },
          verifyOptions: { algorithms: ["HS256"] },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
