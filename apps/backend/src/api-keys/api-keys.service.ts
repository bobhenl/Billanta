import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { generateApiKey, hashApiKey } from "./api-key.util";
import type { CreateApiKeyDto } from "./dto/create-api-key.dto";

type TenantDb = PostgresJsDatabase<typeof schema>;

export interface ValidatedApiKey {
  apiKeyId: string;
  tenantId: string;
}

/**
 * Owns all `api_keys` reads/writes. Two distinct call shapes live here,
 * mirroring `TenantBillingRepository`'s split (see its doc comment):
 *
 *   1. Tenant-management CRUD (`create`/`list`/`revoke`) — called from
 *      `ApiKeysController`, ALWAYS through `req.tenantDb` (the caller is
 *      already authenticated and tenant-scoped by the time these run; RLS's
 *      `tenant_isolation` policy on `api_keys` does the rest).
 *   2. `validateKey`/`touchLastUsed` — called from `ApiKeyAuthGuard` (and
 *      `ApiKeyOrJwtTenantContextMiddleware`) BEFORE any tenant context exists —
 *      the entire point of these two is to establish one. They go through
 *      `DbService.db`/`DbService.sql` directly, via the
 *      `find_active_api_key_by_hash` SECURITY DEFINER function
 *      (`drizzle/rls-policies.sql`) — see `validateKey`'s doc comment.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Generates and persists a new key. Only `keyHash` (never reversible to
   * the plaintext key — see `hashApiKey`'s doc comment) and `keyPrefix`
   * (first 12 chars, for UI identification) are stored. The plaintext `key`
   * on the returned object is NEVER persisted anywhere and this is the only
   * response that will ever contain it — standard API-key UX, matching
   * GitHub/Stripe/etc: lose it and you must revoke + generate a new one.
   */
  async create(tenantDb: TenantDb, tenantId: string, dto: CreateApiKeyDto) {
    const { fullKey, keyPrefix } = generateApiKey();
    const keyHash = hashApiKey(fullKey);

    const [row] = await tenantDb
      .insert(schema.apiKeys)
      .values({ tenantId, name: dto.name, keyPrefix, keyHash, scopes: dto.scopes })
      .returning({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        keyPrefix: schema.apiKeys.keyPrefix,
        scopes: schema.apiKeys.scopes,
        createdAt: schema.apiKeys.createdAt,
      });

    return { ...row, key: fullKey };
  }

  /**
   * Deliberately never selects `keyHash` (or anything the hash could be
   * brute-forced from) — only what the spec calls for: prefix, name,
   * last-used, created-at, plus `revokedAt`/`id`/`scopes` so the dashboard
   * can render revoked keys distinctly and revoke by id without a second
   * round trip.
   */
  list(tenantDb: TenantDb) {
    return tenantDb
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        keyPrefix: schema.apiKeys.keyPrefix,
        scopes: schema.apiKeys.scopes,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        createdAt: schema.apiKeys.createdAt,
        revokedAt: schema.apiKeys.revokedAt,
      })
      .from(schema.apiKeys)
      .orderBy(desc(schema.apiKeys.createdAt));
  }

  /** Soft-revoke: sets `revoked_at`, never hard-deletes (audit trail). */
  async revoke(tenantDb: TenantDb, id: string) {
    const [row] = await tenantDb
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, id), isNull(schema.apiKeys.revokedAt)))
      .returning({ id: schema.apiKeys.id, revokedAt: schema.apiKeys.revokedAt });

    if (!row) {
      throw new NotFoundException("API key not found or already revoked");
    }
    return row;
  }

  /**
   * ============================================================================
   * RLS-before-tenant-is-known, resolved via a SECURITY DEFINER function —
   * see `drizzle/rls-policies.sql`'s "resolving a tenant by API key hash"
   * section for the full rationale (same shape as
   * `TenantBillingRepository.findTenantIdByStripeCustomerId`).
   * ============================================================================
   * Pure lookup, no side effects: does NOT update `last_used_at` (see
   * {@link touchLastUsed}, kept separate and fire-and-forget) and does not
   * throw for an unknown/revoked key — it returns `null`, and callers
   * (`ApiKeyAuthGuard`, `ApiKeyOrJwtTenantContextMiddleware`) decide how to
   * reject.
   */
  async validateKey(rawKey: string): Promise<ValidatedApiKey | null> {
    const keyHash = hashApiKey(rawKey);
    const rows = await this.dbService.db.execute<{ id: string; tenant_id: string }>(
      sql`SELECT * FROM find_active_api_key_by_hash(${keyHash})`,
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { apiKeyId: row.id, tenantId: row.tenant_id };
  }

  /**
   * Fire-and-forget by design: callers must NOT `await` this in the request
   * path. Bumping `last_used_at` is observability, not correctness — it
   * must never add latency to, or cause a failure of, the caller's actual
   * authenticated request. Errors are logged, never thrown or surfaced.
   *
   * Now that `tenantId` is known (from `validateKey`), this is a completely
   * ordinary RLS-scoped write — same `sql.begin()` + `set_config(...)`
   * pattern as `TenantBillingRepository.updateSubscriptionStatus`.
   */
  touchLastUsed(tenantId: string, apiKeyId: string): void {
    this.dbService.sql
      .begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const db = drizzleTx(tx, schema);
        await db
          .update(schema.apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(schema.apiKeys.id, apiKeyId));
      })
      .catch((err: unknown) => {
        this.logger.warn(`Failed to update last_used_at for api key ${apiKeyId}: ${String(err)}`);
      });
  }
}
