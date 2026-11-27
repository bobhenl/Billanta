import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import type { UsageMetric } from "./usage";

type TenantDb = PostgresJsDatabase<typeof schema>;

/**
 * Adds `amount` to a counter unless that would take it over `limit` (null =
 * no limit, always counted). The check and the increment are one statement:
 * the upsert's row lock makes a parallel request wait and re-check against
 * the new count, so the last unit cannot be spent twice. A refused call
 * changes nothing. Runs on whatever RLS-bound connection it is given.
 */
export async function consumeUsage(
  db: TenantDb,
  tenantId: string,
  metric: UsageMetric,
  period: string,
  limit: number | null,
  amount = 1,
): Promise<{ ok: boolean; count: number }> {
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO tenant_usage (tenant_id, metric, period, count)
    SELECT ${tenantId}::uuid, ${metric}, ${period}, ${amount}::int
    WHERE ${limit}::int IS NULL OR ${amount}::int <= ${limit}::int
    ON CONFLICT (tenant_id, metric, period) DO UPDATE
      SET count = tenant_usage.count + EXCLUDED.count, updated_at = now()
      WHERE ${limit}::int IS NULL OR tenant_usage.count + EXCLUDED.count <= ${limit}::int
    RETURNING count`);
  const row = rows[0];
  if (row) return { ok: true, count: Number(row.count) };
  const [current] = await readUsage(db, tenantId, [metric], period);
  return { ok: false, count: current?.count ?? 0 };
}

/** Gives back what a failed call took (an AI request the provider refused). */
export async function refundUsage(db: TenantDb, tenantId: string, metric: UsageMetric, period: string, amount = 1): Promise<void> {
  await db.execute(sql`
    UPDATE tenant_usage SET count = greatest(count - ${amount}::int, 0), updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid AND metric = ${metric} AND period = ${period}`);
}

/** Current counts of `metrics` in one period; metrics with no row are left out. */
export async function readUsage(
  db: TenantDb,
  tenantId: string,
  metrics: UsageMetric[],
  period: string,
): Promise<{ metric: string; count: number }[]> {
  if (metrics.length === 0) return [];
  return db
    .select({ metric: schema.tenantUsage.metric, count: schema.tenantUsage.count })
    .from(schema.tenantUsage)
    .where(and(eq(schema.tenantUsage.tenantId, tenantId), eq(schema.tenantUsage.period, period), inArray(schema.tenantUsage.metric, metrics)));
}
