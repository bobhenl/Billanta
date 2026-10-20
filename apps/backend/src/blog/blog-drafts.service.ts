import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import * as schema from "../../drizzle/schema";
import { getTaxCalendarYear, type TaxEventKind } from "../dashboard/tax-calendar";
import { DbService } from "../db/db.service";
import { autoPublishDecision } from "./blog-autopublish";
import { BriefPostSchema, LOCALE_NAMES, MODEL, STYLE_RULES, TaxPostSchema, TopicPostSchema, topicPost, topicPrompt } from "./blog-prompts";
import { nextTopic, TOPIC_LOCALES, type TopicKind, type TopicLocale } from "./blog-topics";
import { BlogService, blogSlug, type BlogLocale } from "./blog.service";

/** Briefs per rolling week, so the blog grows at a pace someone can still review. */
export const WEEKLY_BRIEF_LIMIT = 3;

/** Rows of the official calendar a small business actually acts on. */
const TAX_KINDS: readonly TaxEventKind[] = ["vat", "income_tax", "flat_tax", "payroll", "road_tax", "property_tax"];

const MONTH_IN = ["v lednu", "v únoru", "v březnu", "v dubnu", "v květnu", "v červnu", "v červenci", "v srpnu", "v září", "v říjnu", "v listopadu", "v prosinci"];

export interface BriefInput {
  locale: BlogLocale;
  topic: string;
  facts: string;
  sources: schema.BlogSource[];
}

const czDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
};

/**
 * AI drafts for the blog. Code builds the facts (for tax posts the whole
 * list of deadlines straight from Finanční správa's calendar, for tool and
 * trade posts our own pages and the invoice requirements check, see
 * blog-topics.ts); the model only writes the prose around them. Everything
 * lands as `pending_review` with the automatic checks attached. A generated
 * kind can go live on its own when its switch in /admin/blog is on, the
 * checks passed, the post isn't about a changing law and the weekly cap
 * isn't reached (blog-autopublish.ts). Briefs always wait for a person.
 *
 * Tax deadline posts are Czech only: the calendar we have is Finanční
 * správa's, and there is no Slovak equivalent to build facts from.
 */
@Injectable()
export class BlogDraftsService {
  private readonly logger = new Logger(BlogDraftsService.name);

  constructor(
    private readonly blog: BlogService,
    private readonly dbService: DbService,
  ) {}

  private client(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new ServiceUnavailableException({ error: "ai_platform_unavailable" });
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /** On the 20th, next month's deadlines, so the post is out well before the 25th. */
  @Cron("0 6 20 * *", { timeZone: "Europe/Prague" })
  async monthly(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) return;
    const now = new Date();
    const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const month = ((now.getMonth() + 1) % 12) + 1;
    try {
      const post = await this.taxDeadlines(year, month);
      if (post) this.logger.log(`Tax deadlines draft ${post.slug}: ${post.status}, warnings ${post.warnings.join(", ") || "none"}`);
    } catch (error) {
      this.logger.warn(`Tax deadlines draft for ${year}-${month} failed: ${(error as Error).message}`);
    }
  }

  /** Czech post "Daňové termíny v <měsíc> <rok>"; null when it exists already or the calendar has nothing. */
  async taxDeadlines(year: number, month: number) {
    const slug = `tax-deadlines-${year}-${String(month).padStart(2, "0")}`;
    if (await this.blog.slugExists("cs", slug)) return null;
    const prefix = `${year}-${String(month).padStart(2, "0")}-`;
    const events = (await getTaxCalendarYear(year))?.filter((e) => e.date.startsWith(prefix) && TAX_KINDS.includes(e.kind));
    if (!events?.length) return null;

    const facts = events.map((e) => `${e.date} | ${e.tax} | ${e.description}`).join("\n");
    const deadlineList = events.map((e) => `- **${czDate(e.date)}**: ${e.tax}. ${e.description.replace(/\.$/, "")}.`).join("\n");
    const monthIn = `${MONTH_IN[month - 1]} ${year}`;

    const draft = await this.parse(TaxPostSchema, 4000, [
      `Write a short Czech article "Daňové termíny ${monthIn}" for sole traders and small companies.`,
      `The full list of deadlines is inserted by code between your intro and your tips, so do not repeat the list; you may refer to the most important ones.`,
      `<facts>\n${facts}\n</facts>`,
    ]);

    const body = [
      draft.intro.trim(),
      `## Termíny ${monthIn}`,
      deadlineList,
      "## Na co nezapomenout",
      draft.tips.map((t) => `- ${t.trim()}`).join("\n"),
      draft.closing.trim(),
    ].join("\n\n");

    const post = await this.blog.create(
      {
        locale: "cs",
        slug,
        title: draft.title.trim(),
        description: draft.description.trim(),
        body,
        sources: [{ title: `Finanční správa ČR, daňový kalendář ${year}`, url: "https://financnisprava.gov.cz/" }],
        facts,
      },
      { kind: "tax_deadlines", status: "pending_review" },
    );
    return this.maybeAutoPublish(post);
  }

  /** Tuesday morning: the next tool and trade topic in each locale, at most four drafts a week. */
  @Cron("0 7 * * 2", { timeZone: "Europe/Prague" })
  async weekly(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) return;
    for (const kind of ["tool_howto", "trade_invoicing"] as const) {
      for (const locale of TOPIC_LOCALES) {
        try {
          const post = await this.nextDraft(kind, locale);
          if (post) this.logger.log(`${kind} draft ${locale}/${post.slug}: ${post.status}, warnings ${post.warnings.join(", ") || "none"}`);
        } catch (error) {
          this.logger.warn(`${kind} draft for ${locale} failed: ${(error as Error).message}`);
        }
      }
    }
  }

  /** The first topic of `kind` not on the blog yet in `locale` (in any status); null when all are written. */
  async nextDraft(kind: TopicKind, locale: TopicLocale) {
    const topic = nextTopic(kind, locale, await this.blog.slugsIn(locale));
    if (!topic) return null;
    const draft = await this.parse(TopicPostSchema, 6000, topicPrompt(topic));
    const post = await this.blog.create(topicPost(topic, draft), { kind, status: "pending_review" });
    return this.maybeAutoPublish(post);
  }

  /** Publishes a fresh generated draft when autoPublishDecision allows it; otherwise it stays in the queue. */
  private async maybeAutoPublish(post: typeof schema.blogPosts.$inferSelect) {
    const [settings, thisWeek] = await Promise.all([this.blog.autopublishSettings(), this.blog.autoPublishedThisWeek()]);
    const verdict = autoPublishDecision({
      kind: post.kind,
      enabled: (settings as Record<string, boolean>)[post.kind] ?? false,
      warnings: post.warnings,
      post,
      publishedThisWeek: thisWeek[post.locale],
    });
    if (!verdict.publish) {
      if (verdict.reason !== "switched_off" && verdict.reason !== "kind_not_auto") this.logger.log(`Not auto-publishing ${post.locale}/${post.slug}: ${verdict.reason}`);
      return post;
    }
    return this.blog.publish(post.id, false, true);
  }

  /** An article from an admin's topic and facts, at most WEEKLY_BRIEF_LIMIT a week. */
  async brief(input: BriefInput) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [{ count }] = await this.dbService.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.blogPosts)
      .where(and(eq(schema.blogPosts.kind, "brief"), gte(schema.blogPosts.createdAt, weekAgo)));
    if (count >= WEEKLY_BRIEF_LIMIT) throw new HttpException({ error: "weekly_draft_limit" }, HttpStatus.TOO_MANY_REQUESTS);

    const sources = input.sources.map((s) => `${s.title}: ${s.url}`).join("\n");
    const draft = await this.parse(BriefPostSchema, 8000, [
      `Write a blog article in ${LOCALE_NAMES[input.locale]}.`,
      `<topic>\n${input.topic}\n</topic>`,
      `<facts>\n${input.facts}\n\nSources:\n${sources}\n</facts>`,
    ]);

    const base = blogSlug.safeParse(draft.slug.slice(0, 80)).data ?? `post-${Date.now().toString(36)}`;
    let slug = base;
    for (let n = 2; await this.blog.slugExists(input.locale, slug); n++) slug = `${base}-${n}`;

    return this.blog.create(
      {
        locale: input.locale,
        slug,
        title: draft.title.trim(),
        description: draft.description.trim(),
        body: draft.body.trim(),
        sources: input.sources,
        facts: `${input.facts}\n${input.topic}`,
      },
      { kind: "brief", status: "pending_review" },
    );
  }

  private async parse<T extends z.ZodType>(format: T, maxTokens: number, parts: string[]): Promise<z.infer<T>> {
    const response = await this.client().beta.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(format) },
      system: STYLE_RULES,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    if (response.stop_reason === "refusal") throw new UnprocessableEntityException({ error: "ai_refused" });
    if (!response.parsed_output) throw new UnprocessableEntityException({ error: "ai_unparseable" });
    return response.parsed_output as z.infer<T>;
  }
}
