import { BadRequestException, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { trialDays } from "../billing/plans";
import { DbService } from "../db/db.service";

export interface TenantMembershipSummary {
  id: string;
  companyName: string;
  role: string;
}

/** Raw column shape returned by `list_tenant_memberships_for_user` (see
 * `drizzle/rls-policies.sql`) — snake_case, since this is a raw SQL
 * function call through `postgres.js`, not a Drizzle schema-table query
 * (Drizzle's camelCase column mapping only applies to the latter).
 * Deliberately a `type` object literal, not an `interface` — TypeScript
 * only grants object-literal types an implicit string index signature,
 * which `DbService.db.execute<TRow extends Record<string, unknown>>`'s
 * generic constraint requires; an `interface` with the same members fails
 * that constraint check. */
type TenantMembershipRow = {
  tenant_id: string;
  company_name: string;
  role: string;
};

/**
 * ============================================================================
 * RLS-before-tenant-is-known resolved via a SECURITY DEFINER function — see
 * `apps/backend/drizzle/rls-policies.sql`'s `list_tenant_memberships_for_user`
 * for the full rationale (same shape as `TenantBillingRepository`'s
 * `findTenantIdByStripeCustomerId`).
 * ============================================================================
 * `GET /api/v1/me` (`MeController`) is called with only a verified JWT and
 * NO `X-Tenant-Id` header — its entire job is telling the caller which
 * tenant(s) exist for this user in the first place, so there is no
 * `app.current_tenant_id` to set yet. `tenant_memberships` has `FORCE ROW
 * LEVEL SECURITY` with a `tenant_id = current_setting('app.current_tenant_id',
 * true)::uuid` policy, so a plain pooled SELECT filtered by `user_id` alone
 * would silently match zero rows, not "every membership this user actually
 * has". This intentionally goes through `DbService.db` (the shared pool),
 * never `req.tenantDb`/`sql.begin` — there is no tenant transaction to join
 * yet, and safety here comes from the SECURITY DEFINER function itself
 * (filtered by `user_id`, returning only `tenant_id`/`company_name`/`role`),
 * not from RLS tenant context.
 */
@Injectable()
export class MeService {
  constructor(private readonly dbService: DbService) {}

  async listTenantMemberships(userId: string): Promise<TenantMembershipSummary[]> {
    const rows = await this.dbService.db.execute<TenantMembershipRow>(
      sql`SELECT * FROM list_tenant_memberships_for_user(${userId})`,
    );
    return rows.map((row) => ({
      id: row.tenant_id,
      companyName: row.company_name,
      role: row.role,
    }));
  }

  /**
   * Another company for an existing user, through the same
   * `bootstrap_tenant_for_user` the signup uses (owner membership + terms
   * acceptance). Capped so a free account can't mint unlimited companies.
   */
  async createTenant(userId: string, companyName: string, tosVersion: string, ipAddress: string | null) {
    const owned = (await this.listTenantMemberships(userId)).filter((m) => m.role === "owner").length;
    if (owned >= MAX_OWNED_TENANTS) {
      throw new BadRequestException({ error: "tenant_limit", message: `At most ${MAX_OWNED_TENANTS} companies per account` });
    }
    const [row] = await this.dbService.db.execute<{ tenant_id: string }>(
      sql`SELECT bootstrap_tenant_for_user(${userId}, ${companyName}, ${tosVersion}, ${ipAddress}, ${trialDays()}) AS tenant_id`,
    );
    return { id: row!.tenant_id, companyName: companyName.trim(), role: "owner" };
  }
}

export const MAX_OWNED_TENANTS = 10;
