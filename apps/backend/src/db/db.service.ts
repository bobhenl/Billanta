import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../drizzle/schema";

/**
 * Owns the Postgres connection pool + a pool-bound Drizzle instance.
 *
 * IMPORTANT: `this.db` (bound to the shared pool) must ONLY be used for
 * tenant-agnostic queries — the global catalog tables that have no RLS
 * policy (`subscription_plans`, `ares_cache`, `tos_versions`) or `users`
 * itself. Any query against a tenant-scoped table (contacts, invoices,
 * tenant_memberships, ...) MUST go through the reserved, `SET LOCAL`-scoped
 * connection that `TenantContextMiddleware` attaches to the request as
 * `req.tenantDb` — never this pool directly. Querying a tenant-scoped table
 * through `this.db` will, at best, return zero rows (RLS with no
 * `app.current_tenant_id` set matches nothing) and at worst — if RLS were
 * ever misconfigured — silently return every tenant's data. See
 * `src/tenancy/tenant-context.middleware.ts` for the full explanation.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  public readonly sql: ReturnType<typeof postgres>;
  public readonly db: PostgresJsDatabase<typeof schema>;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>("DATABASE_URL");
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set – see .env.example");
    }

    this.sql = postgres(connectionString, { max: 10 });
    this.db = drizzle(this.sql, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
