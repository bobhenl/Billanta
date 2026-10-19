import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, desc, eq, gte, ne } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { AUTO_PUBLISH_KINDS, type AutoPublishKind } from "./blog-autopublish";
import { blogWarnings } from "./blog-checks";

export const BLOG_LOCALES = ["cs", "sk", "en"] as const;
export type BlogLocale = (typeof BLOG_LOCALES)[number];

type BlogPostRow = typeof schema.blogPosts.$inferSelect;

/** English kebab-case, the same slug style as the rest of the public site. */
export const blogSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/);

export const blogSourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https:\/\//i.test(u), "https only"),
});

export const blogPostSchema = z.object({
  locale: z.enum(BLOG_LOCALES),
  slug: blogSlug,
  translation_key: blogSlug.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(50_000),
  sources: z.array(blogSourceSchema).max(15).default([]),
  facts: z.string().max(20_000).nullish(),
});
export type BlogPostInput = z.infer<typeof blogPostSchema>;

/** Admin list without the (long) body. */
const listColumns = {
  id: schema.blogPosts.id,
  locale: schema.blogPosts.locale,
  slug: schema.blogPosts.slug,
  translationKey: schema.blogPosts.translationKey,
  title: schema.blogPosts.title,
  kind: schema.blogPosts.kind,
  status: schema.blogPosts.status,
  warnings: schema.blogPosts.warnings,
  autoPublished: schema.blogPosts.autoPublished,
  publishedAt: schema.blogPosts.publishedAt,
  createdAt: schema.blogPosts.createdAt,
  updatedAt: schema.blogPosts.updatedAt,
};

const published = eq(schema.blogPosts.status, "published");

/**
 * Articles behind /blog. `blog_posts` is global (no RLS), so the pool is the
 * right connection (see DbService). Warnings are recomputed on every save so
 * the admin always sees the checks for the text as it stands.
 */
@Injectable()
export class BlogService {
  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  listPublic(locale: BlogLocale) {
    return this.db
      .select({
        slug: schema.blogPosts.slug,
        title: schema.blogPosts.title,
        description: schema.blogPosts.description,
        kind: schema.blogPosts.kind,
        publishedAt: schema.blogPosts.publishedAt,
      })
      .from(schema.blogPosts)
      .where(and(published, eq(schema.blogPosts.locale, locale)))
      .orderBy(desc(schema.blogPosts.publishedAt))
      .limit(200);
  }

  /** Every published post in every locale, for the sitemap. */
  listForSitemap() {
    return this.db
      .select({
        locale: schema.blogPosts.locale,
        slug: schema.blogPosts.slug,
        translationKey: schema.blogPosts.translationKey,
        updatedAt: schema.blogPosts.updatedAt,
      })
      .from(schema.blogPosts)
      .where(published);
  }

  async getPublic(locale: BlogLocale, slug: string) {
    const [post] = await this.db
      .select({
        slug: schema.blogPosts.slug,
        translationKey: schema.blogPosts.translationKey,
        title: schema.blogPosts.title,
        description: schema.blogPosts.description,
        body: schema.blogPosts.body,
        kind: schema.blogPosts.kind,
        sources: schema.blogPosts.sources,
        publishedAt: schema.blogPosts.publishedAt,
        updatedAt: schema.blogPosts.updatedAt,
      })
      .from(schema.blogPosts)
      .where(and(published, eq(schema.blogPosts.locale, locale), eq(schema.blogPosts.slug, slug.toLowerCase())));
    if (!post) throw new NotFoundException("Post not found");
    const alternates = await this.db
      .select({ locale: schema.blogPosts.locale, slug: schema.blogPosts.slug })
      .from(schema.blogPosts)
      .where(and(published, eq(schema.blogPosts.translationKey, post.translationKey), ne(schema.blogPosts.locale, locale)));
    return { ...post, alternates };
  }

  // --- Platform admin ------------------------------------------------------

  listAll() {
    return this.db.select(listColumns).from(schema.blogPosts).orderBy(desc(schema.blogPosts.updatedAt)).limit(500);
  }

  async get(id: string): Promise<BlogPostRow> {
    const [row] = await this.db.select().from(schema.blogPosts).where(eq(schema.blogPosts.id, id));
    if (!row) throw new NotFoundException("Post not found");
    return row;
  }

  /** Hand-written posts start as drafts; generated ones pass their own kind and status. */
  async create(
    input: BlogPostInput,
    meta: { kind?: BlogPostRow["kind"]; status?: BlogPostRow["status"] } = {},
  ): Promise<BlogPostRow> {
    const values: typeof schema.blogPosts.$inferInsert = {
      locale: input.locale,
      slug: input.slug,
      translationKey: input.translation_key ?? input.slug,
      title: input.title,
      description: input.description,
      body: input.body,
      sources: input.sources,
      facts: input.facts ?? null,
      kind: meta.kind ?? "manual",
      status: meta.status ?? "draft",
      warnings: blogWarnings(input),
    };
    try {
      const [row] = await this.db.insert(schema.blogPosts).values(values).returning();
      return row!;
    } catch (error) {
      throw this.slugTaken(error);
    }
  }

  async update(id: string, input: Partial<BlogPostInput>): Promise<BlogPostRow> {
    const current = await this.get(id);
    const next = {
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      body: input.body ?? current.body,
      sources: input.sources ?? current.sources,
      facts: input.facts !== undefined ? (input.facts ?? null) : current.facts,
    };
    try {
      const [row] = await this.db
        .update(schema.blogPosts)
        .set({
          ...next,
          ...(input.locale !== undefined && { locale: input.locale }),
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.translation_key !== undefined && { translationKey: input.translation_key }),
          warnings: blogWarnings(next),
          updatedAt: new Date(),
        })
        .where(eq(schema.blogPosts.id, id))
        .returning();
      return row!;
    } catch (error) {
      throw this.slugTaken(error);
    }
  }

  /**
   * A post with warnings needs `force`: someone has to have read why.
   * `auto` is the generator publishing without a click (it never forces);
   * those posts count towards the weekly cap.
   */
  async publish(id: string, force: boolean, auto = false): Promise<BlogPostRow> {
    const current = await this.get(id);
    if (current.warnings.length > 0 && (!force || auto)) throw new ConflictException("post_has_warnings");
    const [row] = await this.db
      .update(schema.blogPosts)
      .set({ status: "published", publishedAt: current.publishedAt ?? new Date(), autoPublished: auto, updatedAt: new Date() })
      .where(eq(schema.blogPosts.id, id))
      .returning();
    return row!;
  }

  /** Back to the review queue (unpublish) or out of it (reject). */
  async setStatus(id: string, status: "draft" | "rejected"): Promise<BlogPostRow> {
    const [row] = await this.db
      .update(schema.blogPosts)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.blogPosts.id, id))
      .returning();
    if (!row) throw new NotFoundException("Post not found");
    return row;
  }

  async remove(id: string) {
    const [row] = await this.db.delete(schema.blogPosts).where(eq(schema.blogPosts.id, id)).returning({ id: schema.blogPosts.id });
    if (!row) throw new NotFoundException("Post not found");
    return { deleted: true };
  }

  /** Auto-publish switches for every kind that has one; a missing row is off. */
  async autopublishSettings(): Promise<Record<AutoPublishKind, boolean>> {
    const rows = await this.db.select().from(schema.blogAutopublish);
    return Object.fromEntries(AUTO_PUBLISH_KINDS.map((k) => [k, rows.some((r) => r.kind === k && r.enabled)])) as Record<AutoPublishKind, boolean>;
  }

  async setAutopublish(kind: AutoPublishKind, enabled: boolean) {
    await this.db
      .insert(schema.blogAutopublish)
      .values({ kind, enabled })
      .onConflictDoUpdate({ target: schema.blogAutopublish.kind, set: { enabled, updatedAt: new Date() } });
    return this.autopublishSettings();
  }

  /** Posts the generator published on its own in the last 7 days, per locale. */
  async autoPublishedThisWeek(): Promise<Record<BlogLocale, number>> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ locale: schema.blogPosts.locale, n: count() })
      .from(schema.blogPosts)
      .where(and(eq(schema.blogPosts.autoPublished, true), gte(schema.blogPosts.publishedAt, weekAgo)))
      .groupBy(schema.blogPosts.locale);
    return Object.fromEntries(BLOG_LOCALES.map((l) => [l, rows.find((r) => r.locale === l)?.n ?? 0])) as Record<BlogLocale, number>;
  }

  /** Slugs already used in a locale, in any status (a rejected topic is not drafted again). */
  async slugsIn(locale: BlogLocale): Promise<Set<string>> {
    const rows = await this.db.select({ slug: schema.blogPosts.slug }).from(schema.blogPosts).where(eq(schema.blogPosts.locale, locale));
    return new Set(rows.map((r) => r.slug));
  }

  async slugExists(locale: BlogLocale, slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.blogPosts.id })
      .from(schema.blogPosts)
      .where(and(eq(schema.blogPosts.locale, locale), eq(schema.blogPosts.slug, slug)));
    return Boolean(row);
  }

  private slugTaken(error: unknown) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    return code === "23505" ? new ConflictException("slug_taken") : error;
  }
}
