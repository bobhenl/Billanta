import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { mergeNotificationPrefs, notificationPrefsOf } from "../notifications/notification-prefs";
import { isUnsubscribed, unsubscribePatch } from "./email-types";
import { unsubscribeSecret, verifyUnsubscribeToken, type UnsubscribeClaims } from "./unsubscribe-token";

/**
 * The public unsubscribe link. The signed token names the tenant, member and
 * e-mail type, so the change runs inside that tenant's RLS context like any
 * other prefs write; nothing here can touch another tenant or member.
 */
@Injectable()
export class EmailUnsubscribeService {
  constructor(private readonly dbService: DbService) {}

  private claimsOf(token: string): UnsubscribeClaims {
    const secret = unsubscribeSecret();
    if (!secret) throw new ServiceUnavailableException("unsubscribe_unavailable");
    const claims = verifyUnsubscribeToken(token, secret);
    if (!claims) throw new BadRequestException("invalid_unsubscribe_link");
    return claims;
  }

  private inTenant<T>(tenantId: string, fn: (db: PostgresJsDatabase<typeof schema>) => Promise<T>): Promise<T> {
    return this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(drizzleTx(tx, schema));
    }) as Promise<T>;
  }

  /** What the page shows before the click: which e-mails, for which company, and whether they're already off. */
  async preview(token: string) {
    const claims = this.claimsOf(token);
    return this.inTenant(claims.tenantId, async (db) => {
      const [row] = await db
        .select({ prefs: schema.tenantMemberships.notificationPrefs, companyName: schema.tenants.companyName })
        .from(schema.tenantMemberships)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
        .where(and(eq(schema.tenantMemberships.tenantId, claims.tenantId), eq(schema.tenantMemberships.userId, claims.userId)))
        .limit(1);
      // No longer a member: nothing is sent to them from this company anyway.
      if (!row) return { type: claims.type, companyName: null, unsubscribed: true };
      return { type: claims.type, companyName: row.companyName, unsubscribed: isUnsubscribed(notificationPrefsOf(row.prefs), claims.type) };
    });
  }

  /** Turns the e-mail type off. Repeating it is harmless (mail clients may POST twice). */
  async unsubscribe(token: string) {
    const claims = this.claimsOf(token);
    await this.inTenant(claims.tenantId, async (db) => {
      const where = and(eq(schema.tenantMemberships.tenantId, claims.tenantId), eq(schema.tenantMemberships.userId, claims.userId));
      const [row] = await db
        .select({ prefs: schema.tenantMemberships.notificationPrefs })
        .from(schema.tenantMemberships)
        .where(where)
        .limit(1)
        .for("update");
      if (!row) return;
      await db
        .update(schema.tenantMemberships)
        .set({ notificationPrefs: mergeNotificationPrefs(row.prefs, unsubscribePatch(claims.type)) })
        .where(where);
    });
    return { type: claims.type, unsubscribed: true };
  }
}
