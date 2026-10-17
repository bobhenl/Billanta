import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";

export const PARTNER_CATEGORIES = ["accounting", "banking", "software", "service", "other"] as const;
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

/** How many partners the site footer shows (VoxelRank: FOOTER_PARTNER_LIMIT). */
export const FOOTER_PARTNER_LIMIT = 8;

/** One visitor's repeated clicks on the same partner count once per hour. */
const CLICK_COOLDOWN_MS = 60 * 60 * 1000;
const CLICK_MAX_KEYS = 50_000;

const BOT_UA = /bot|crawl|spider|slurp|preview|fetch|curl|wget|python|headless|facebookexternalhit|embedly/i;

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), "http(s) only");

export const partnerSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/),
  name: z.string().trim().min(1).max(120),
  url: httpUrl,
  description: z.string().trim().max(500).nullish(),
  logo_url: httpUrl.nullish(),
  category: z.enum(PARTNER_CATEGORIES).default("other"),
  featured: z.boolean().default(false),
  show_in_footer: z.boolean().default(false),
  weight: z.coerce.number().int().min(-1000).max(1000).default(0),
  active: z.boolean().default(true),
});
export type PartnerInput = z.infer<typeof partnerSchema>;

const publicColumns = {
  slug: schema.partners.slug,
  name: schema.partners.name,
  description: schema.partners.description,
  logoUrl: schema.partners.logoUrl,
  category: schema.partners.category,
  featured: schema.partners.featured,
};

/**
 * The partners directory (/partners, the footer strip, `/partners/go/:slug`).
 * `partners` is a global catalogue with no RLS, so the pool connection is
 * the right one here (see DbService). Public reads never expose the target
 * URL or click counts: visitors reach a partner only through the counting
 * redirect.
 */
@Injectable()
export class PartnersService {
  private readonly recentClicks = new Map<string, number>();

  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  /** Active partners, featured and heavier first, optionally one category or just the footer ones. */
  listPublic(opts: { category?: PartnerCategory; footer?: boolean }) {
    const where = [eq(schema.partners.active, true)];
    if (opts.category) where.push(eq(schema.partners.category, opts.category));
    if (opts.footer) where.push(eq(schema.partners.showInFooter, true));
    const query = this.db
      .select(publicColumns)
      .from(schema.partners)
      .where(and(...where))
      .orderBy(desc(schema.partners.featured), desc(schema.partners.weight), asc(schema.partners.name));
    return opts.footer ? query.limit(FOOTER_PARTNER_LIMIT) : query;
  }

  /**
   * Target URL of an active partner for the redirect, counting the click
   * unless it looks like a bot or the same visitor clicked within the hour.
   */
  async click(slug: string, visitor: string, userAgent: string | undefined): Promise<{ url: string }> {
    const [partner] = await this.db
      .select({ id: schema.partners.id, url: schema.partners.url })
      .from(schema.partners)
      .where(and(eq(schema.partners.slug, slug.toLowerCase()), eq(schema.partners.active, true)));
    if (!partner) throw new NotFoundException("Partner not found");
    if (!userAgent || BOT_UA.test(userAgent) || !this.firstClick(`${visitor}|${partner.id}`)) return { url: partner.url };
    await this.db
      .update(schema.partners)
      .set({ clicks: sql`${schema.partners.clicks} + 1` })
      .where(eq(schema.partners.id, partner.id));
    return { url: partner.url };
  }

  private firstClick(key: string, now = Date.now()): boolean {
    const last = this.recentClicks.get(key);
    if (last && now - last < CLICK_COOLDOWN_MS) return false;
    if (this.recentClicks.size >= CLICK_MAX_KEYS) {
      for (const [k, at] of this.recentClicks) if (now - at >= CLICK_COOLDOWN_MS) this.recentClicks.delete(k);
      // Still full: drop the oldest entries (Map keeps insertion order).
      for (const k of this.recentClicks.keys()) {
        if (this.recentClicks.size < CLICK_MAX_KEYS) break;
        this.recentClicks.delete(k);
      }
    }
    this.recentClicks.delete(key);
    this.recentClicks.set(key, now);
    return true;
  }

  // --- Platform admin ------------------------------------------------------

  listAll() {
    return this.db
      .select()
      .from(schema.partners)
      .orderBy(desc(schema.partners.featured), desc(schema.partners.weight), asc(schema.partners.name));
  }

  async create(input: PartnerInput) {
    try {
      const [row] = await this.db.insert(schema.partners).values(this.toRow(input)).returning();
      return row;
    } catch (error) {
      throw this.slugTaken(error);
    }
  }

  async update(id: string, input: Partial<PartnerInput>) {
    try {
      const [row] = await this.db
        .update(schema.partners)
        .set({ ...this.toRow(input), updatedAt: new Date() })
        .where(eq(schema.partners.id, id))
        .returning();
      if (!row) throw new NotFoundException("Partner not found");
      return row;
    } catch (error) {
      throw this.slugTaken(error);
    }
  }

  async remove(id: string) {
    const [row] = await this.db.delete(schema.partners).where(eq(schema.partners.id, id)).returning({ id: schema.partners.id });
    if (!row) throw new NotFoundException("Partner not found");
    return { deleted: true };
  }

  private toRow(input: Partial<PartnerInput>) {
    const row: Partial<typeof schema.partners.$inferInsert> = {};
    if (input.slug !== undefined) row.slug = input.slug;
    if (input.name !== undefined) row.name = input.name;
    if (input.url !== undefined) row.url = input.url;
    if (input.description !== undefined) row.description = input.description ?? null;
    if (input.logo_url !== undefined) row.logoUrl = input.logo_url ?? null;
    if (input.category !== undefined) row.category = input.category;
    if (input.featured !== undefined) row.featured = input.featured;
    if (input.show_in_footer !== undefined) row.showInFooter = input.show_in_footer;
    if (input.weight !== undefined) row.weight = input.weight;
    if (input.active !== undefined) row.active = input.active;
    return row as typeof schema.partners.$inferInsert;
  }

  private slugTaken(error: unknown) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    return code === "23505" ? new ConflictException("slug_taken") : error;
  }
}
