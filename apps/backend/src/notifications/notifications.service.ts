import { dispatchWebhooks } from "../integrations/webhooks";
import { Injectable, Logger } from "@nestjs/common";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { emailLocaleOf } from "../email/email-render";
import { EmailOutboxService } from "../email/email-outbox.service";
import { emailTypesView, type EmailTypeInfo } from "../email/email-types";
import { EmailService } from "../email/email.service";
import {
  NOTIFICATION_EVENTS,
  mergeNotificationPrefs,
  notificationPrefsOf,
  type NotificationEvent,
  type NotificationPrefsPatch,
} from "./notification-prefs";
import type { EmailPrefsPatch } from "./email-prefs.schema";

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
    private readonly outbox: EmailOutboxService,
  ) {}

  notify(tenantId: string, kind: NotificationEvent, payload: NotificationPayload): void {
    void this.deliver(tenantId, kind, payload).catch((err) =>
      this.logger.warn(`Notification ${kind} for tenant ${tenantId} failed: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Writes the in-app rows and queues the e-mails (batched per member and
   * held over their quiet hours by the outbox); returns how many were made.
   */
  async deliver(tenantId: string, kind: NotificationEvent, payload: NotificationPayload): Promise<number> {
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
    let emails = 0;
    let inApp = 0;
    let hooks: { webhooks: unknown; company: string; locale: string | null } | undefined;
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
      [hooks] = await db
        .select({ webhooks: schema.tenants.webhooks, company: schema.tenants.companyName, locale: schema.tenants.defaultLocale })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId));
      const rows: (typeof schema.notifications.$inferInsert)[] = [];
      for (const m of members) {
        const prefs = notificationPrefsOf(m.prefs);
        const channels = prefs.events[kind];
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
        if (channels.email && m.email) {
          await this.outbox.enqueueNotification(
            {
              userId: m.userId,
              to: m.email,
              kind,
              title: payload.title,
              body: payload.body,
              url: payload.link ? `${siteUrl}${payload.link}` : null,
              quietHours: prefs.quietHours,
              locale: emailLocaleOf(hooks?.locale),
            },
            { tenantId, db },
          );
          emails++;
        }
      }
      if (rows.length) await db.insert(schema.notifications).values(rows);
      inApp = rows.length;
    });
    let hooked = 0;
    if (hooks) {
      hooked = await dispatchWebhooks(hooks.webhooks, kind, payload, { company: hooks.company, siteUrl }).catch((err) => {
        this.logger.warn(`Webhook dispatch failed: ${err instanceof Error ? err.message : err}`);
        return 0;
      });
    }
    return inApp + emails + hooked;
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
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
    let members: { userId: string; email: string | null }[] = [];
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      members = await db
        .select({ userId: schema.tenantMemberships.userId, email: schema.users.email })
        .from(schema.tenantMemberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
        .where(eq(schema.tenantMemberships.tenantId, tenantId));
      for (const m of members) {
        if (!m.email) continue;
        await this.emailService.sendSecurityAlertEmail(
          { to: m.email, title: payload.title, body: payload.body, url: payload.link ? `${siteUrl}${payload.link}` : null },
          { tenantId, db, userId: m.userId },
        );
      }
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

  /** Settings → E-mailová upozornění: every e-mail type with its switch, the digest and quiet hours. */
  async getEmailPrefs(db: TenantDb, tenantId: string, userId: string) {
    return emailPrefsView(await this.getPrefs(db, tenantId, userId));
  }

  async setEmailPrefs(db: TenantDb, tenantId: string, userId: string, patch: EmailPrefsPatch) {
    const events: NonNullable<NotificationPrefsPatch["events"]> = {};
    let weeklyDigest = patch.weekly_digest;
    for (const [type, on] of Object.entries(patch.types ?? {})) {
      if (type === "weekly_digest") weeklyDigest = on;
      else if ((NOTIFICATION_EVENTS as readonly string[]).includes(type)) events[type as NotificationEvent] = { email: on };
      // Locked types (security, invitations, mail to customers) are ignored: they can't be switched off.
    }
    const next = await this.setPrefs(db, tenantId, userId, {
      events,
      ...(weeklyDigest === undefined ? {} : { weekly_digest: weeklyDigest }),
      ...(patch.quiet_hours ? { quiet_hours: patch.quiet_hours } : {}),
    });
    return emailPrefsView(next);
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

function emailPrefsView(prefs: ReturnType<typeof notificationPrefsOf>): {
  types: (EmailTypeInfo & { enabled: boolean })[];
  weeklyDigest: boolean;
  quietHours: ReturnType<typeof notificationPrefsOf>["quietHours"];
} {
  return { types: emailTypesView(prefs), weeklyDigest: prefs.weeklyDigest, quietHours: prefs.quietHours };
}
