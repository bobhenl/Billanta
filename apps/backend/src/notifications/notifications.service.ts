import { dispatchWebhooks } from "../integrations/webhooks";
import { Injectable, Logger } from "@nestjs/common";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { EmailService } from "../email/email.service";
import {
  mergeNotificationPrefs,
  notificationPrefsOf,
  type NotificationEvent,
  type NotificationPrefsPatch,
} from "./notification-prefs";

type TenantDb = PostgresJsDatabase<typeof schema>;

export interface NotificationPayload {
  title: string;
  body?: string | null;
  /** App path without locale, e.g. `/invoices/<id>`. */
  link?: string | null;
}

/**
 * Member notifications (Settings → Notifikace): the bell in the header, an
 * optional browser popup, and/or an email — per event, per member.
 * `notify` is fire-and-forget: a failing notification never breaks the
 * action that triggered it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly emailService: EmailService,
  ) {}

  notify(tenantId: string, kind: NotificationEvent, payload: NotificationPayload): void {
    void this.deliver(tenantId, kind, payload).catch((err) =>
      this.logger.warn(`Notification ${kind} for tenant ${tenantId} failed: ${err instanceof Error ? err.message : err}`),
    );
  }

  /** Writes the in-app rows and sends the emails; returns how many went out. */
  async deliver(tenantId: string, kind: NotificationEvent, payload: NotificationPayload): Promise<number> {
    const emails: string[] = [];
    let inApp = 0;
    let hooks: { webhooks: unknown; company: string } | undefined;
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      const members = await db
        .select({
          userId: schema.tenantMemberships.userId,
          prefs: schema.tenantMemberships.notificationPrefs,
          email: schema.users.email,
        })
        .from(schema.tenantMemberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
        .where(eq(schema.tenantMemberships.tenantId, tenantId));
      const rows: (typeof schema.notifications.$inferInsert)[] = [];
      for (const m of members) {
        const channels = notificationPrefsOf(m.prefs).events[kind];
        if (channels.app) {
          rows.push({
            tenantId,
            userId: m.userId,
            kind,
            title: payload.title.slice(0, 200),
            body: payload.body ?? null,
            link: payload.link?.slice(0, 300) ?? null,
          });
        }
        if (channels.email && m.email) emails.push(m.email);
      }
      if (rows.length) await db.insert(schema.notifications).values(rows);
      inApp = rows.length;
      [hooks] = await db
        .select({ webhooks: schema.tenants.webhooks, company: schema.tenants.companyName })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId));
    });
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
    for (const to of emails) {
      await this.emailService
        .sendNotificationEmail({ to, title: payload.title, body: payload.body, url: payload.link ? `${siteUrl}${payload.link}` : null })
        .catch((err) => this.logger.warn(`Notification email failed: ${err instanceof Error ? err.message : err}`));
    }
    let hooked = 0;
    if (hooks) {
      hooked = await dispatchWebhooks(hooks.webhooks, kind, payload, { company: hooks.company, siteUrl }).catch((err) => {
        this.logger.warn(`Webhook dispatch failed: ${err instanceof Error ? err.message : err}`);
        return 0;
      });
    }
    return inApp + emails.length + hooked;
  }

  /**
   * Security alerts (e.g. the payout bank account changed): every member gets
   * the bell entry and an email regardless of their notification preferences,
   * and no webhooks fire. Fire-and-forget like `notify`.
   */
  notifySecurity(tenantId: string, payload: NotificationPayload): void {
    void this.deliverSecurity(tenantId, payload).catch((err) =>
      this.logger.warn(`Security alert for tenant ${tenantId} failed: ${err instanceof Error ? err.message : err}`),
    );
  }

  async deliverSecurity(tenantId: string, payload: NotificationPayload): Promise<number> {
    let members: { userId: string; email: string | null }[] = [];
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      members = await db
        .select({ userId: schema.tenantMemberships.userId, email: schema.users.email })
        .from(schema.tenantMemberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
        .where(eq(schema.tenantMemberships.tenantId, tenantId));
      if (members.length) {
        await db.insert(schema.notifications).values(
          members.map((m) => ({
            tenantId,
            userId: m.userId,
            kind: "security_alert",
            title: payload.title.slice(0, 200),
            body: payload.body ?? null,
            link: payload.link?.slice(0, 300) ?? null,
          })),
        );
      }
    });
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
    for (const m of members) {
      if (!m.email) continue;
      await this.emailService
        .sendNotificationEmail({ to: m.email, title: payload.title, body: payload.body, url: payload.link ? `${siteUrl}${payload.link}` : null })
        .catch((err) => this.logger.warn(`Security alert email failed: ${err instanceof Error ? err.message : err}`));
    }
    return members.length;
  }

  async list(db: TenantDb, userId: string, limit = 30) {
    return db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  }

  async unreadCount(db: TenantDb, userId: string) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
    return { unread: n };
  }

  /** One notification, or all unread ones when `id` is omitted. */
  async markRead(db: TenantDb, userId: string, id?: string) {
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
          ...(id ? [eq(schema.notifications.id, id)] : []),
        ),
      );
    return { ok: true };
  }

  async getPrefs(db: TenantDb, tenantId: string, userId: string) {
    const [m] = await db
      .select({ prefs: schema.tenantMemberships.notificationPrefs })
      .from(schema.tenantMemberships)
      .where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.userId, userId)))
      .limit(1);
    return notificationPrefsOf(m?.prefs);
  }

  async setPrefs(db: TenantDb, tenantId: string, userId: string, patch: NotificationPrefsPatch) {
    const next = mergeNotificationPrefs(await this.getPrefs(db, tenantId, userId), patch);
    await db
      .update(schema.tenantMemberships)
      .set({ notificationPrefs: next })
      .where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.userId, userId)));
    return next;
  }
}
