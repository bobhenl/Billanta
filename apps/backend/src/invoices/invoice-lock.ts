import { HttpException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";

type TenantDb = PostgresJsDatabase<typeof schema>;

/**
 * How long one re-auth opens locked invoices. The frontend keeps a signed
 * cookie for this long and puts the `ul` claim into each backend JWT.
 */
export const UNLOCK_WINDOW_MINUTES = 15;

/**
 * A locked invoice opens only for a person who re-entered their password a
 * moment ago. Integrations (API keys, the AI service) are not a person at an
 * unattended laptop, which is what the lock is for, so they pass.
 */
export function lockBlocks(lockedAt: Date | null, user: Pick<AuthenticatedUser, "apiKey" | "role" | "unlocked">): boolean {
  if (!lockedAt) return false;
  if (user.apiKey || user.role === "service") return false;
  return user.unlocked !== true;
}

/** 423 `invoice_locked` unless the caller may open this invoice (see `lockBlocks`). */
export async function assertInvoiceOpen(db: TenantDb, id: string, user: AuthenticatedUser): Promise<void> {
  // A malformed id is the route's own 400/404 to give.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const [row] = await db.select({ lockedAt: schema.invoices.lockedAt }).from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
  if (row && lockBlocks(row.lockedAt, user)) throw new HttpException("invoice_locked", 423);
}

/**
 * A locked row in a list keeps its number, dates, status and amounts (totals
 * and filters still count it) but not who it is for or what the notes say.
 */
export function maskLockedRow<T extends { lockedAt: Date | null }>(row: T, user: AuthenticatedUser): T & { locked: boolean } {
  if (!lockBlocks(row.lockedAt, user)) return { ...row, locked: Boolean(row.lockedAt) };
  return { ...row, locked: true, contactName: null, contactIco: null, internalNote: null, noteAbove: null, noteBelow: null, clientResponseNote: null };
}
