import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import type { OutboxItem } from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import type { QuietHours } from "../notifications/notification-prefs";
import { htmlToText, renderNotificationEmail, type EmailLocale } from "./email-render";
import type { EmailCategory, UnsubscribeType } from "./email-types";
import { afterQuietHours, nonUrgentSendAfter, OUTBOX } from "./outbox-policy";
import { listUnsubscribeHeaders, signUnsubscribeToken, unsubscribePageUrl, unsubscribeSecret } from "./unsubscribe-token";

type TenantDb = PostgresJsDatabase<typeof schema>;

export interface OutgoingAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface OutgoingEmail {
  kind: string;
  category: EmailCategory;
  to: string;
  subject: string;
  html: string;
  /** Defaults to a text rendering of `html`. */
  text?: string;
  fromName?: string | null;
  replyTo?: string | null;
  bcc?: string | null;
  attachments?: OutgoingAttachment[];
  headers?: Record<string, string>;
  userId?: string | null;
  /** Same key within the tenant = the same e-mail; a second enqueue is a no-op. */
  idempotencyKey?: string;
  sendAfter?: Date;
}

/**
 * Where an e-mail is enqueued: inside the caller's tenant transaction when
 * there is one (so the e-mail exists exactly when the action that caused it
 * committed), otherwise in a short transaction of its own.
 */
export interface QueueContext {
  tenantId: string;
  db?: TenantDb;
}

export interface NotificationEmail {
  userId: string;
  to: string;
  kind: string;
  title: string;
  body?: string | null;
  url?: string | null;
  quietHours: QuietHours;
  locale: EmailLocale;
}

/** Signed unsubscribe link + RFC 8058 headers for a member, or nothing when there is no secret to sign with. */
export function unsubscribeFor(tenantId: string, userId: string, type: UnsubscribeType, locale: EmailLocale) {
  const secret = unsubscribeSecret();
  if (!secret) return { pageUrl: null, headers: {} as Record<string, string> };
  const token = signUnsubscribeToken({ tenantId, userId, type }, secret);
  return { pageUrl: unsubscribePageUrl(token, locale), headers: listUnsubscribeHeaders(token) };
}

/** Writes e-mails into `email_outbox`; `EmailOutboxWorker` delivers them. */
@Injectable()
export class EmailOutboxService {
  constructor(private readonly dbService: DbService) {}

  private async inTenant<T>(ctx: QueueContext, fn: (db: TenantDb) => Promise<T>): Promise<T> {
    if (ctx.db) return fn(ctx.db);
    return this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, true)`;
      return fn(drizzleTx(tx, schema));
    }) as Promise<T>;
  }

  /** Queues one e-mail. Returns the row id, or null when the idempotency key was already used. */
  async enqueue(email: OutgoingEmail, ctx: QueueContext): Promise<string | null> {
    const sendAfter = email.sendAfter ?? new Date();
    return this.inTenant(ctx, async (db) => {
      const [row] = await db
        .insert(schema.emailOutbox)
        .values({
          tenantId: ctx.tenantId,
          userId: email.userId ?? null,
          kind: email.kind,
          category: email.category,
          idempotencyKey: (email.idempotencyKey ?? `${email.kind}:${randomUUID()}`).slice(0, 200),
          recipient: email.to.trim(),
          fromName: email.fromName ?? null,
          replyTo: email.replyTo ?? null,
          bcc: email.bcc ?? null,
          subject: email.subject.slice(0, 300),
          html: email.html,
          textBody: email.text ?? htmlToText(email.html),
          headers: email.headers ?? {},
          attachments: email.attachments?.length
            ? email.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content.toString("base64") }))
            : null,
          maxAttempts: OUTBOX.maxAttempts,
          sendAfter,
        })
        .onConflictDoNothing()
        .returning({ id: schema.emailOutbox.id });
      return row?.id ?? null;
    });
  }

  /**
   * A member notification. If one for the same member is still waiting
   * (batching window or quiet hours), this one joins it and the merged
   * e-mail is re-rendered; otherwise a new row waits out the window. The
   * `FOR UPDATE` keeps two notifications from merging into the same row at
   * once, and the worker's `SKIP LOCKED` claim leaves a row being merged alone.
   */
  async enqueueNotification(n: NotificationEmail, ctx: QueueContext): Promise<string | null> {
    const batchKey = `notify:${n.userId}`;
    const item: OutboxItem = { kind: n.kind, title: n.title.slice(0, 200), body: n.body ?? null, url: n.url ?? null, at: new Date().toISOString() };
    return this.inTenant(ctx, async (db) => {
      const [open] = await db
        .select({ id: schema.emailOutbox.id, items: schema.emailOutbox.items })
        .from(schema.emailOutbox)
        .where(
          and(
            eq(schema.emailOutbox.tenantId, ctx.tenantId),
            eq(schema.emailOutbox.batchKey, batchKey),
            eq(schema.emailOutbox.status, "queued"),
          ),
        )
        .limit(1)
        .for("update");
      const items = [...(open?.items ?? []), item].slice(-50);
      const kinds = new Set(items.map((i) => i.kind));
      const unsubscribeType = (kinds.size === 1 ? n.kind : "all") as UnsubscribeType;
      const unsub = unsubscribeFor(ctx.tenantId, n.userId, unsubscribeType, n.locale);
      const rendered = renderNotificationEmail(items, { locale: n.locale, unsubscribeUrl: unsub.pageUrl });
      if (open) {
        await db
          .update(schema.emailOutbox)
          .set({
            items,
            kind: kinds.size === 1 ? n.kind : "notification_batch",
            recipient: n.to,
            subject: rendered.subject,
            html: rendered.html,
            textBody: rendered.text,
            headers: unsub.headers,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.emailOutbox.id, open.id), eq(schema.emailOutbox.status, "queued")));
        return open.id;
      }
      const [row] = await db
        .insert(schema.emailOutbox)
        .values({
          tenantId: ctx.tenantId,
          userId: n.userId,
          kind: n.kind,
          category: "notification",
          idempotencyKey: `notify:${randomUUID()}`,
          batchKey,
          recipient: n.to,
          subject: rendered.subject,
          html: rendered.html,
          textBody: rendered.text,
          headers: unsub.headers,
          items,
          maxAttempts: OUTBOX.maxAttempts,
          sendAfter: nonUrgentSendAfter(new Date(), n.quietHours),
        })
        .returning({ id: schema.emailOutbox.id });
      return row?.id ?? null;
    });
  }

  /** The weekly digest: not batched, but it waits out quiet hours like any non-urgent e-mail. */
  enqueueDigest(email: Omit<OutgoingEmail, "category" | "sendAfter">, quietHours: QuietHours, ctx: QueueContext) {
    return this.enqueue({ ...email, category: "digest", sendAfter: afterQuietHours(new Date(), quietHours) }, ctx);
  }
}
