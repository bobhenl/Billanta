import { ConflictException, Injectable } from "@nestjs/common";
import { eq, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";

type Db = PostgresJsDatabase<typeof schema>;

const ADMIN_ROLES = ["owner", "admin"] as const;

type Plan = { tenantId: string; companyName: string; action: "wipe" | "leave" };

/**
 * "Delete my account" (idea from faktorio, MIT © Jiri Spac): for each company
 * the user belongs to, either wipes it completely (the user is its only
 * member) or just removes the membership (others keep working). Refuses up
 * front — before touching anything — when the user is the last admin of a
 * shared company, or issued documents there (the issuer stays on record).
 *
 * The `users` row itself belongs to the frontend's Auth.js tables and is
 * deleted there once this succeeds.
 */
@Injectable()
export class AccountDeletionService {
  constructor(private readonly dbService: DbService) {}

  async deleteAccountData(userId: string): Promise<{ wiped: string[]; left: string[] }> {
    const memberships = await this.dbService.db.execute<{ tenant_id: string; company_name: string }>(
      sql`SELECT tenant_id, company_name FROM list_tenant_memberships_for_user(${userId})`,
    );

    const plans: Plan[] = [];
    for (const m of memberships) {
      plans.push(await this.inTenant(m.tenant_id, (db) => this.plan(db, userId, m.tenant_id, m.company_name)));
    }

    for (const p of plans) {
      await this.inTenant(p.tenantId, (db) => (p.action === "wipe" ? this.wipe(db, p.tenantId) : this.leave(db, userId)));
    }
    return {
      wiped: plans.filter((p) => p.action === "wipe").map((p) => p.companyName),
      left: plans.filter((p) => p.action === "leave").map((p) => p.companyName),
    };
  }

  private inTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
    return this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(drizzleTx(tx, schema));
    }) as Promise<T>;
  }

  private async plan(db: Db, userId: string, tenantId: string, companyName: string): Promise<Plan> {
    const others = await db
      .select({ role: schema.tenantMemberships.role })
      .from(schema.tenantMemberships)
      .where(ne(schema.tenantMemberships.userId, userId));
    if (others.length === 0) return { tenantId, companyName, action: "wipe" };

    const [me] = await db
      .select({ role: schema.tenantMemberships.role })
      .from(schema.tenantMemberships)
      .where(eq(schema.tenantMemberships.userId, userId));
    const isAdmin = (r: string | undefined) => ADMIN_ROLES.includes(r as (typeof ADMIN_ROLES)[number]);
    if (isAdmin(me?.role) && !others.some((o) => isAdmin(o.role))) {
      throw new ConflictException({ error: "last_admin", company: companyName });
    }
    const [issued] = await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.issuedByUserId, userId))
      .limit(1);
    if (issued) throw new ConflictException({ error: "issued_in_shared", company: companyName });
    return { tenantId, companyName, action: "leave" };
  }

  private async leave(db: Db, userId: string) {
    await db.delete(schema.tenantMemberships).where(eq(schema.tenantMemberships.userId, userId));
  }

  /** Deletes every row of the company. Explicit order for the FKs declared ON DELETE RESTRICT. */
  private async wipe(db: Db, tenantId: string) {
    await db.update(schema.invoices).set({ relatedInvoiceId: null });
    await db.delete(schema.recurringInvoiceTemplates);
    await db.delete(schema.invoices);
    await db.delete(schema.expenses);
    await db.delete(schema.invoiceNumberSequences);
    await db.delete(schema.tenantBankAccounts);
    await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)); // the rest cascades
  }
}
