import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";

/** Lowercased addresses from `PLATFORM_ADMIN_EMAILS` (comma separated). */
export function platformAdminEmails(raw = process.env.PLATFORM_ADMIN_EMAILS ?? ""): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Billanta's own staff (the partners catalogue), not any company's admin.
 * Runs after `JwtAuthGuard`. The address in the token must be listed in
 * `PLATFORM_ADMIN_EMAILS` AND proven: the user either confirmed it by email
 * or signs in with Google under it, so registering an unconfirmed account
 * with an admin's address grants nothing. Unset env = nobody.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly dbService: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();
    const email = req.user?.email?.toLowerCase();
    if (!req.user?.id || !email || !platformAdminEmails().has(email)) throw new ForbiddenException("Platform admins only");
    const db = this.dbService.db;
    const [user] = await db
      .select({ email: schema.users.email, verified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.id, req.user.id));
    if (!user || user.email.toLowerCase() !== email) throw new ForbiddenException("Platform admins only");
    if (user.verified) return true;
    const [google] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, req.user.id), eq(schema.accounts.provider, "google")));
    if (google) return true;
    throw new ForbiddenException("Platform admins only");
  }
}
