import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import * as schema from "../../drizzle/schema";
import { getTaxCalendarYear, type TaxEventKind } from "../dashboard/tax-calendar";
import { DbService } from "../db/db.service";
import { BlogService, blogSlug, type BlogLocale } from "./blog.service";

const MODEL = process.env.AI_MODEL ?? "claude-opus-5";

/** Briefs per rolling week, so the blog grows at a pace someone can still review. */
export const WEEKLY_BRIEF_LIMIT = 3;

/** Rows of the official calendar a small business actually acts on. */
const TAX_KINDS: readonly TaxEventKind[] = ["vat", "income_tax", "flat_tax", "payroll", "road_tax", "property_tax"];

const MONTH_IN = ["v lednu", "v únoru", "v březnu", "v dubnu", "v květnu", "v červnu", "v červenci", "v srpnu", "v září", "v říjnu", "v listopadu", "v prosinci"];

const LOCALE_NAMES: Record<BlogLocale, string> = { cs: "Czech", sk: "Slovak (real Slovak, not Czech with a few words changed)", en: "English" };

const STYLE_RULES = `You write articles for the blog of Billanta, an invoicing app for Czech and Slovak sole traders and small companies.

Rules:
- Use ONLY the facts given in <facts>. Never add a date, amount, rate, paragraph number or law number that is not in the facts. If something is not in the facts, leave it out.
- No promises: never write that the reader saves tax, is guaranteed anything or never has to do something. This is general information, not tax advice.
- Plain, friendly, concrete. Short sentences. No marketing superlatives, no emoji.
- Formatting is a restricted markdown: plain paragraphs, "## " headings, "- " bullet lists, **bold**. Links only as [text](https://...) and only to URLs given in the facts or sources. No HTML, no tables, no images.
- Mention Billanta at most once, briefly and without claims beyond what the facts say.`;

const TaxPostSchema = z.object({
  title: z.string().describe("Headline, under 90 characters, containing the month and year"),
  description: z.string().describe("Meta description, 120-200 characters"),
  intro: z.string().describe("One or two short paragraphs introducing the month's deadlines"),
  tips: z.array(z.string()).describe("Two to four practical reminders, one sentence each, no new numbers"),
  closing: z.string().describe("One short closing paragraph ending with a full stop"),
});

const BriefPostSchema = z.object({
  slug: z.string().describe("English kebab-case URL slug, at most 80 characters"),
  title: z.string().describe("Headline, under 100 characters"),
  description: z.string().describe("Meta description, 120-200 characters"),
  body: z.string().describe("The article in restricted markdown, 600-1200 words, ending with a full stop"),
});

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
 * list of deadlines straight from Finanční správa's calendar); the model only
 * writes the prose around them. Everything lands as `pending_review` with
 * the automatic checks attached. Only a monthly tax post without warnings
 * can go live on its own, and only with BLOG_AUTOPUBLISH_TAX_DEADLINES=1.
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
    if (process.env.BLOG_AUTOPUBLISH_TAX_DEADLINES === "1" && post.warnings.length === 0) return this.blog.publish(post.id, false);
    return post;
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
