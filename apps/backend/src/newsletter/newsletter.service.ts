import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { taxDeadlinesFor, type TaxDeadlineKind } from "@faktur/cz-compliance";
import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { upcomingTaxEvents } from "../dashboard/tax-calendar";
import { DbService } from "../db/db.service";
import { emailLocaleOf } from "../email/email-render";
import { listUnsubscribeHeaders, unsubscribePageUrl, unsubscribeSecret } from "../email/unsubscribe-token";
import { TAX_LABELS } from "../integrations/integrations.service";
import { buildNewsletterDraft } from "./newsletter-draft";
import { renderNewsletterConfirmation, renderNewsletterIssue } from "./newsletter-render";
import type { IssueInput, MeNewsletterInput, SubscribeInput } from "./newsletter.schemas";
import { CONFIRM_TOKEN, hashConfirmToken, newConfirmToken, signNewsletterUnsubscribeToken } from "./newsletter-token";

const T = schema.newsletterSubscribers;
const I = schema.newsletterIssues;

/** A new confirmation e-mail to the same address at most this often. */
const CONFIRM_COOLDOWN_MS = 15 * 60 * 1000;
/** The double opt-in link works this long. */
const CONFIRM_VALID_DAYS = 7;
/** Unconfirmed sign-ups are deleted after this (the confirmation e-mail promises it). */
export const PENDING_RETENTION_DAYS = 30;
/** Subscribers rendered and queued per transaction during a send. */
const SEND_CHUNK = 200;

/** Deadline kinds an issue lists: the ones most readers share, not every OSVČ monthly advance. */
const DRAFT_DEADLINE_KINDS: TaxDeadlineKind[] = ["vat_monthly", "income_tax", "flat_tax", "overviews", "road_tax", "property_tax"];

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");

/**
 * The newsletter: double opt-in sign-up, the logged-in toggle, and the
 * admin compose-and-send. Every table it touches is global (no tenant), so
 * it uses the pool; e-mail goes into the outbox only through
 * enqueue_newsletter_email (migration 0074), which re-checks the opt-in in
 * the database.
 */
@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);
  private readonly sending = new Set<string>();

  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  private async findByEmail(email: string) {
    const [row] = await this.db.select().from(T).where(sql`lower(${T.email}) = ${email.toLowerCase()}`).limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------- sign-up

  /**
   * Public form. The answer is the same whatever the address's state, so the
   * form can't be used to find out who subscribes. A confirmed address is
   * left alone (a stranger must not change someone else's topics); a
   * pending or unsubscribed one gets a fresh confirmation, at most once per
   * cooldown.
   */
  async subscribe(input: SubscribeInput, now = new Date()): Promise<{ ok: true }> {
    if (input.website) return { ok: true };
    const existing = await this.findByEmail(input.email);
    if (existing?.status === "confirmed") return { ok: true };
    if (existing?.confirmSentAt && now.getTime() - existing.confirmSentAt.getTime() < CONFIRM_COOLDOWN_MS) return { ok: true };
    await this.startOptIn(existing?.id ?? null, input, input.source, null, now);
    return { ok: true };
  }

  /** Writes a pending row with a fresh token and queues the confirmation e-mail. */
  private async startOptIn(
    id: string | null,
    input: { email: string; locale: "cs" | "sk" | "en"; country: "CZ" | "SK"; topics: schema.NewsletterTopic[]; consentText: string },
    source: string,
    userId: string | null,
    now: Date,
  ) {
    const { token, hash } = newConfirmToken();
    const values = {
      locale: input.locale,
      country: input.country,
      topics: input.topics,
      status: "pending" as const,
      source,
      consentText: input.consentText,
      consentAt: now,
      confirmTokenHash: hash,
      confirmSentAt: now,
      updatedAt: now,
      ...(userId ? { userId } : {}),
    };
    let subscriberId = id;
    if (subscriberId) {
      await this.db.update(T).set(values).where(eq(T.id, subscriberId));
    } else {
      try {
        const [row] = await this.db.insert(T).values({ ...values, email: input.email }).returning({ id: T.id });
        subscriberId = row!.id;
      } catch (err) {
        // Two sign-ups for the same address at once: the other one sends the e-mail.
        if ((err as { code?: string }).code === "23505") return;
        throw err;
      }
    }
    const mail = renderNewsletterConfirmation(input.locale, `${siteUrl()}/${input.locale}/newsletter/confirm/${token}`);
    await this.dbService.sql`
      SELECT enqueue_newsletter_email(${subscriberId}, 'newsletter_confirm', ${`newsletter_confirm:${subscriberId}:${now.getTime()}`},
        ${mail.subject}, ${mail.html}, ${mail.text}, '{}'::jsonb)`;
  }

  private async findByConfirmToken(token: string, now: Date) {
    if (!CONFIRM_TOKEN.test(token)) throw new BadRequestException("invalid_confirm_link");
    const [row] = await this.db.select().from(T).where(eq(T.confirmTokenHash, hashConfirmToken(token))).limit(1);
    if (!row) throw new BadRequestException("invalid_confirm_link");
    const fresh = row.confirmSentAt && now.getTime() - row.confirmSentAt.getTime() < CONFIRM_VALID_DAYS * 86_400_000;
    if (row.status === "pending" && !fresh) throw new BadRequestException("confirm_link_expired");
    if (row.status === "unsubscribed") throw new BadRequestException("invalid_confirm_link");
    return row;
  }

  /** What the confirmation page shows before the click (GET never confirms: mail scanners prefetch links). */
  async confirmPreview(token: string, now = new Date()) {
    const row = await this.findByConfirmToken(token, now);
    return { status: row.status, email: maskEmail(row.email), topics: row.topics, country: row.country };
  }

  async confirm(token: string, now = new Date()) {
    const row = await this.findByConfirmToken(token, now);
    if (row.status === "pending") {
      await this.db
        .update(T)
        .set({ status: "confirmed", confirmedAt: now, unsubscribedAt: null, updatedAt: now })
        .where(and(eq(T.id, row.id), eq(T.status, "pending")));
    }
    return { status: "confirmed" as const, email: maskEmail(row.email), topics: row.topics, country: row.country };
  }

  // ------------------------------------------------------------ unsubscribe

  /** Idempotent. Queued issues for the address die in claim_email_outbox. */
  async unsubscribe(subscriberId: string, now = new Date()) {
    await this.db
      .update(T)
      .set({ status: "unsubscribed", unsubscribedAt: now, confirmTokenHash: null, updatedAt: now })
      .where(and(eq(T.id, subscriberId), sql`${T.status} <> 'unsubscribed'`));
  }

  /** Deletes sign-ups never confirmed; unsubscribed rows stay as the record of the opt-out. */
  async purgeUnconfirmed(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - PENDING_RETENTION_DAYS * 86_400_000);
    const rows = await this.db
      .delete(T)
      .where(and(eq(T.status, "pending"), sql`${T.confirmedAt} IS NULL`, sql`${T.consentAt} < ${cutoff}`))
      .returning({ id: T.id });
    return rows.length;
  }

  // -------------------------------------------------------- logged-in user

  private async account(userId: string) {
    const [user] = await this.db
      .select({ email: schema.users.email, verified: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) throw new NotFoundException("user_not_found");
    let verified = !!user.verified;
    if (!verified) {
      const [google] = await this.db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.provider, "google")));
      verified = !!google;
    }
    return { email: user.email.toLowerCase(), verified };
  }

  private view(row: typeof T.$inferSelect | null, defaultCountry: "CZ" | "SK") {
    return {
      status: (row?.status ?? "none") as "none" | "pending" | "confirmed" | "unsubscribed",
      topics: row && row.status !== "unsubscribed" ? row.topics : [...schema.NEWSLETTER_TOPICS],
      country: row?.country ?? defaultCountry,
    };
  }

  async getForUser(userId: string, defaultCountry: "CZ" | "SK") {
    const { email } = await this.account(userId);
    return this.view(await this.findByEmail(email), defaultCountry);
  }

  /**
   * Settings toggle. A signed-in user with a proven address (confirmed, or
   * Google) is subscribed at once: the switch is their explicit consent and
   * the address is known to be theirs. Otherwise it goes through the same
   * double opt-in as the public form.
   */
  async setForUser(userId: string, defaultCountry: "CZ" | "SK", input: MeNewsletterInput, now = new Date()) {
    const { email, verified } = await this.account(userId);
    let row = await this.findByEmail(email);
    if (!input.subscribed) {
      if (row) await this.unsubscribe(row.id, now);
      return this.view(await this.findByEmail(email), defaultCountry);
    }
    const country = input.country ?? row?.country ?? defaultCountry;
    const topics = input.topics ?? (row && row.status !== "unsubscribed" ? row.topics : [...schema.NEWSLETTER_TOPICS]);
    if (row?.status === "confirmed") {
      await this.db.update(T).set({ country, topics, locale: input.locale, userId, updatedAt: now }).where(eq(T.id, row.id));
      return this.view(await this.findByEmail(email), defaultCountry);
    }
    if (!input.consentText) throw new BadRequestException("consent_required");
    if (verified) {
      const values = {
        locale: input.locale,
        country,
        topics,
        status: "confirmed" as const,
        source: "settings",
        userId,
        consentText: input.consentText,
        consentAt: now,
        confirmedAt: now,
        unsubscribedAt: null,
        confirmTokenHash: null,
        updatedAt: now,
      };
      if (row) await this.db.update(T).set(values).where(eq(T.id, row.id));
      else await this.db.insert(T).values({ ...values, email }).onConflictDoNothing();
    } else if (!(row?.status === "pending" && row.confirmSentAt && now.getTime() - row.confirmSentAt.getTime() < CONFIRM_COOLDOWN_MS)) {
      await this.startOptIn(row?.id ?? null, { email, locale: input.locale, country, topics, consentText: input.consentText }, "settings", userId, now);
    }
    row = await this.findByEmail(email);
    return this.view(row, defaultCountry);
  }

  // ------------------------------------------------------------------ admin

  async stats() {
    const rows = await this.db
      .select({ status: T.status, country: T.country, locale: T.locale, n: sql<number>`count(*)::int` })
      .from(T)
      .groupBy(T.status, T.country, T.locale);
    const topics = await this.db
      .select({ topic: sql<string>`unnest(${T.topics})`, n: sql<number>`count(*)::int` })
      .from(T)
      .where(eq(T.status, "confirmed"))
      .groupBy(sql`1`);
    return { segments: rows, topics };
  }

  listIssues() {
    return this.db
      .select({
        id: I.id,
        locale: I.locale,
        country: I.country,
        topics: I.topics,
        subject: I.subject,
        status: I.status,
        queuedCount: I.queuedCount,
        sentAt: I.sentAt,
        createdAt: I.createdAt,
      })
      .from(I)
      .orderBy(desc(I.createdAt))
      .limit(100);
  }

  async getIssue(id: string) {
    const [row] = await this.db.select().from(I).where(eq(I.id, id));
    if (!row) throw new NotFoundException("issue_not_found");
    return { ...row, audience: await this.audienceCount(row) };
  }

  async createIssue(input: IssueInput, userId: string) {
    const [row] = await this.db.insert(I).values({ ...input, createdBy: userId }).returning();
    return { ...row!, audience: await this.audienceCount(row!) };
  }

  async updateIssue(id: string, input: Partial<IssueInput>) {
    const [row] = await this.db
      .update(I)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(I.id, id), eq(I.status, "draft")))
      .returning();
    if (!row) throw new ConflictException("issue_not_editable");
    return { ...row, audience: await this.audienceCount(row) };
  }

  async deleteIssue(id: string) {
    const rows = await this.db.delete(I).where(and(eq(I.id, id), eq(I.status, "draft"))).returning({ id: I.id });
    if (!rows.length) throw new ConflictException("issue_not_editable");
    return { ok: true };
  }

  /** A draft issue from recent blog posts and upcoming deadlines; the admin edits it before sending. */
  async createDraft(locale: "cs" | "sk" | "en", country: "CZ" | "SK" | null, userId: string, now = new Date()) {
    const [last] = await this.db
      .select({ sentAt: I.sentAt })
      .from(I)
      .where(and(eq(I.locale, locale), eq(I.status, "sent")))
      .orderBy(desc(I.sentAt))
      .limit(1);
    const since = last?.sentAt ?? new Date(now.getTime() - 45 * 86_400_000);
    const posts = await this.db
      .select({ title: schema.blogPosts.title, description: schema.blogPosts.description, slug: schema.blogPosts.slug })
      .from(schema.blogPosts)
      .where(and(eq(schema.blogPosts.status, "published"), eq(schema.blogPosts.locale, locale), gte(schema.blogPosts.publishedAt, since)))
      .orderBy(desc(schema.blogPosts.publishedAt))
      .limit(8);
    let deadlines: { label: string; date: Date }[] = [];
    if (country !== "SK") {
      const official = await upcomingTaxEvents(30, now).catch(() => null);
      deadlines = taxDeadlinesFor(DRAFT_DEADLINE_KINDS, { country: "CZ", vatStatus: "payer", legalEntity: false }, official, now, 30).map((d) => ({
        label: TAX_LABELS[locale][d.kind],
        date: d.date,
      }));
    }
    const draft = buildNewsletterDraft({ locale, now, posts, deadlines });
    return this.createIssue({ locale, country, topics: [...schema.NEWSLETTER_TOPICS], ...draft }, userId);
  }

  private audienceWhere(issue: { locale: string; country: string | null; topics: string[] }) {
    return and(
      eq(T.status, "confirmed"),
      eq(T.locale, issue.locale as "cs"),
      issue.country ? eq(T.country, issue.country as "CZ") : undefined,
      sql`${T.topics} && ${sql`ARRAY[${sql.join(issue.topics.map((t) => sql`${t}`), sql`, `)}]::text[]`}`,
    );
  }

  private async audienceCount(issue: { locale: string; country: string | null; topics: string[] }): Promise<number> {
    if (!issue.topics.length) return 0;
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(T).where(this.audienceWhere(issue));
    return row?.n ?? 0;
  }

  /** The e-mail as a subscriber would get it (with a placeholder address and link). */
  async preview(id: string) {
    const issue = await this.getIssue(id);
    const locale = emailLocaleOf(issue.locale);
    return renderNewsletterIssue(issue, { locale, email: "jmeno@example.com", unsubscribeUrl: `${siteUrl()}/${locale}/unsubscribe/preview` });
  }

  /**
   * Starts (or resumes) sending. Recipients are queued in chunks in the
   * background; every row's idempotency key is issue + subscriber, so a
   * resumed send never mails anyone twice. The outbox worker then delivers
   * them after all other mail, a batch a minute.
   */
  async send(id: string) {
    const secret = unsubscribeSecret();
    if (!secret) throw new ServiceUnavailableException("unsubscribe_unavailable");
    const [issue] = await this.db
      .update(I)
      .set({ status: "sending", sendStartedAt: sql`coalesce(${I.sendStartedAt}, now())`, updatedAt: new Date() })
      .where(and(eq(I.id, id), sql`${I.status} IN ('draft', 'sending')`))
      .returning();
    if (!issue) throw new ConflictException("issue_already_sent");
    if (!issue.topics.length) throw new BadRequestException("issue_without_topics");
    if (!this.sending.has(id)) {
      this.sending.add(id);
      void this.queueAll(issue, secret).finally(() => this.sending.delete(id));
    }
    return { ...issue, audience: await this.audienceCount(issue) };
  }

  private async queueAll(issue: typeof I.$inferSelect, secret: string) {
    try {
      const locale = emailLocaleOf(issue.locale);
      let after = "00000000-0000-0000-0000-000000000000";
      for (;;) {
        const batch = await this.db
          .select({ id: T.id, email: T.email })
          .from(T)
          .where(and(this.audienceWhere(issue), gt(T.id, after)))
          .orderBy(T.id)
          .limit(SEND_CHUNK);
        if (!batch.length) break;
        const queued = await this.dbService.sql.begin(async (tx) => {
          let n = 0;
          for (const s of batch) {
            const token = signNewsletterUnsubscribeToken(s.id, secret);
            const mail = renderNewsletterIssue(issue, { locale, email: s.email, unsubscribeUrl: unsubscribePageUrl(token, locale) });
            const [row] = await tx<{ id: string | null }[]>`
              SELECT enqueue_newsletter_email(${s.id}, 'newsletter_issue', ${`newsletter:${issue.id}:${s.id}`},
                ${mail.subject}, ${mail.html}, ${mail.text}, ${JSON.stringify(listUnsubscribeHeaders(token))}::jsonb) AS id`;
            if (row?.id) n++;
          }
          return n;
        });
        if (queued) await this.db.update(I).set({ queuedCount: sql`${I.queuedCount} + ${queued}` }).where(eq(I.id, issue.id));
        after = batch[batch.length - 1]!.id;
      }
      await this.db.update(I).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(I.id, issue.id));
      this.logger.log(`newsletter issue ${issue.id} queued`);
    } catch (err) {
      // Stays 'sending'; pressing Send again resumes where it stopped.
      this.logger.error(`newsletter issue ${issue.id} failed while queueing: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** j***@example.com: enough for the person to recognise their address, not enough to harvest it. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}
