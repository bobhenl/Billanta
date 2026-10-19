import { BadRequestException, ConflictException } from "@nestjs/common";
import { and, eq, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";

type TenantDb = PostgresJsDatabase<typeof schema>;

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * The `Idempotency-Key` header, or null when the client sent none. A key
 * that is there but malformed is rejected rather than ignored, so a client
 * that relies on it never silently loses the protection.
 */
export function parseIdempotencyKey(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value === "") return null;
  if (!KEY_PATTERN.test(value)) throw new BadRequestException({ error: "invalid_idempotency_key" });
  return value;
}

/**
 * Runs `create` at most once per key and tenant (docs/offline-drafts-plan.md).
 * The key row goes in first, inside the request's own transaction: a retry
 * after a lost response finds it and gets `replay(resourceId)`; a parallel
 * request with the same key blocks on the primary key until the first one
 * commits. If `create` throws, the transaction rolls back and the key is free
 * again. RLS keeps every key inside the caller's tenant.
 */
export async function withIdempotencyKey<T>(
  db: TenantDb,
  tenantId: string,
  key: string | null,
  scope: string,
  create: () => Promise<T>,
  idOf: (created: T) => string,
  replay: (resourceId: string) => Promise<T>,
): Promise<T> {
  if (!key) return create();
  await db
    .delete(schema.idempotencyKeys)
    .where(lt(schema.idempotencyKeys.createdAt, sql`now() - interval '30 days'`));
  const [fresh] = await db
    .insert(schema.idempotencyKeys)
    .values({ tenantId, key, scope })
    .onConflictDoNothing()
    .returning({ key: schema.idempotencyKeys.key });
  if (!fresh) {
    const [seen] = await db
      .select({ scope: schema.idempotencyKeys.scope, resourceId: schema.idempotencyKeys.resourceId })
      .from(schema.idempotencyKeys)
      .where(and(eq(schema.idempotencyKeys.tenantId, tenantId), eq(schema.idempotencyKeys.key, key)))
      .limit(1);
    if (!seen || seen.scope !== scope || !seen.resourceId) throw new ConflictException({ error: "idempotency_key_reused" });
    return replay(seen.resourceId);
  }
  const created = await create();
  await db
    .update(schema.idempotencyKeys)
    .set({ resourceId: idOf(created) })
    .where(and(eq(schema.idempotencyKeys.tenantId, tenantId), eq(schema.idempotencyKeys.key, key)));
  return created;
}
