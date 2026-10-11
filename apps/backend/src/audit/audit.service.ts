import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";

type TenantDb = PostgresJsDatabase<typeof schema>;

export type AuditEntityType = "invoice" | "tenant" | "bank_account" | "contact" | "member" | "api_key";

export interface AuditEntry {
  entityType: AuditEntityType;
  entityId?: string | null;
  /** Human name at the time, e.g. the invoice number — survives a later delete. */
  entityLabel?: string | null;
  action: string;
  changes?: schema.AuditChange[];
  reason?: string | null;
}

const comparable = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined || v === "" ? null : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

/**
 * Settings → Historie změn and the history on a document: who did what,
 * per field old → new, with an optional reason. Writes go through the
 * request's own transaction so an entry exists exactly when the change
 * committed; the actor is filled in by the column defaults (see
 * migrations/0038_audit_log.sql). The table is append-only.
 */
@Injectable()
export class AuditService {
  async record(db: TenantDb, tenantId: string, entry: AuditEntry) {
    await db.insert(schema.auditLog).values({
      tenantId,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      entityLabel: entry.entityLabel?.slice(0, 200) ?? null,
      action: entry.action,
      changes: entry.changes ?? [],
      reason: entry.reason?.trim().slice(0, 1000) || null,
    });
  }

  /** The fields of `after` that differ from `before` (only keys present in `after`, minus `skip`). */
  diff(before: Record<string, unknown>, after: Record<string, unknown>, skip: string[] = []): schema.AuditChange[] {
    const changes: schema.AuditChange[] = [];
    for (const [field, to] of Object.entries(after)) {
      if (to === undefined || skip.includes(field)) continue;
      const from = before[field];
      if (comparable(from) !== comparable(to)) changes.push({ field, from: from ?? null, to: to ?? null });
    }
    return changes;
  }

  async list(
    db: TenantDb,
    tenantId: string,
    opts: { entityType?: string; entityId?: string; limit?: number; before?: string; userId?: string; from?: string; to?: string; action?: string },
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const conditions = [eq(schema.auditLog.tenantId, tenantId)];
    if (opts.entityType) conditions.push(eq(schema.auditLog.entityType, opts.entityType));
    if (opts.entityId) conditions.push(eq(schema.auditLog.entityId, opts.entityId));
    if (opts.before && !Number.isNaN(Date.parse(opts.before))) conditions.push(lt(schema.auditLog.createdAt, new Date(opts.before)));
    if (opts.action) conditions.push(eq(schema.auditLog.action, opts.action));
    if (opts.userId) conditions.push(eq(schema.auditLog.userId, opts.userId));
    // Whole days: `to` includes the day itself.
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (opts.from && day.test(opts.from)) conditions.push(gte(schema.auditLog.createdAt, new Date(`${opts.from}T00:00:00Z`)));
    if (opts.to && day.test(opts.to)) conditions.push(lt(schema.auditLog.createdAt, new Date(Date.parse(`${opts.to}T00:00:00Z`) + 86_400_000)));
    const rows = await db
      .select({
        id: schema.auditLog.id,
        entityType: schema.auditLog.entityType,
        entityId: schema.auditLog.entityId,
        entityLabel: schema.auditLog.entityLabel,
        action: schema.auditLog.action,
        changes: schema.auditLog.changes,
        reason: schema.auditLog.reason,
        actor: schema.auditLog.actor,
        createdAt: schema.auditLog.createdAt,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
      .where(and(...conditions))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(limit + 1);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }
}
