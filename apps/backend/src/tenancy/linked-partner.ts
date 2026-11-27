import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { taxModelOf } from "../net-income/tax-model";
import { meetsRequirement, requirementFor } from "./permissions";

const READS = new Set(["GET", "HEAD"]);
const NET_INCOME = /^v1\/net-income(\/|$)/;
const SHARES = /^v1\/invoices\/[^/]+\/partner-shares$/;

/**
 * What a member linked to a partner of the tax model (`partners[].user_id`)
 * may do in the owner/admin-only "Po zdanění" area on top of their role. They
 * read the report and the model, because the numbers are their own. They split
 * an invoice only where their invoice permission lets them edit it, because a
 * split moves income between partners like any other edit of the document.
 * Changing the model itself (rates, partners, who is linked) stays with owners
 * and admins. Says nothing about the link itself: see `isLinkedPartner`.
 */
export function linkedPartnerMay(role: string, method: string, path: string, permissions?: unknown): boolean {
  if (role !== "accountant" && role !== "viewer") return false;
  const m = method.toUpperCase();
  if (READS.has(m)) return NET_INCOME.test(path) || path === "v1/tenants/me/tax-model";
  if (m === "PUT" && SHARES.test(path)) {
    const req = requirementFor(method, path);
    return !!req && req !== "admin" && meetsRequirement(role, permissions, req);
  }
  return false;
}

/** Whether `userId` is linked to a partner in the tenant's tax model. Reads through the tenant's own RLS-scoped transaction. */
export async function isLinkedPartner(db: PostgresJsDatabase<typeof schema> | undefined, tenantId: string, userId: string): Promise<boolean> {
  if (!db || !userId) return false;
  const [t] = await db.select({ taxModel: schema.tenants.taxModel }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return taxModelOf(t?.taxModel).partners.some((p) => p.user_id === userId);
}
