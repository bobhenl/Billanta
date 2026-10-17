import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { filterListings, toPublicListing, type ListingValues, type PublicListing, type PublicListingRow } from "./listing";

type TenantDb = PostgresJsDatabase<typeof schema>;

const LISTING_COLUMNS = {
  displayName: schema.accountantListings.displayName,
  bio: schema.accountantListings.bio,
  regions: schema.accountantListings.regions,
  remote: schema.accountantListings.remote,
  services: schema.accountantListings.services,
  languages: schema.accountantListings.languages,
  priceHint: schema.accountantListings.priceHint,
  contactEmail: schema.accountantListings.contactEmail,
  website: schema.accountantListings.website,
  status: schema.accountantListings.status,
  reviewNote: schema.accountantListings.reviewNote,
  reviewedAt: schema.accountantListings.reviewedAt,
  updatedAt: schema.accountantListings.updatedAt,
};

/**
 * The accountant directory (/accountants). A company's own listing is read
 * and written under RLS through `tenantDb`; RLS itself refuses any status
 * but 'pending' or 'withdrawn', so saving always sends the listing back to
 * review. The public page and the admin queue go through the SECURITY
 * DEFINER functions of migration 0054, never through the pool directly.
 */
@Injectable()
export class AccountantDirectoryService {
  private cache: { at: number; rows: PublicListing[] } | null = null;

  constructor(private readonly dbService: DbService) {}

  async own(db: TenantDb, tenantId: string) {
    const [tenant] = await db.select({ program: schema.tenants.referralProgram }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    const [listing] = await db.select(LISTING_COLUMNS).from(schema.accountantListings).where(eq(schema.accountantListings.tenantId, tenantId));
    return { eligible: tenant?.program === "accountant", listing: listing ?? null };
  }

  async save(db: TenantDb, tenantId: string, values: ListingValues) {
    const [tenant] = await db.select({ program: schema.tenants.referralProgram }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    // The directory is part of the partner programme: the IČO check lives
    // in ReferralsService.setProgram, so it is not repeated here.
    if (tenant?.program !== "accountant") throw new BadRequestException("accountant_program_required");
    const row = { ...values, status: "pending" as const, reviewNote: null, reviewedAt: null, updatedAt: new Date() };
    const [saved] = await db
      .insert(schema.accountantListings)
      .values({ tenantId, ...row })
      .onConflictDoUpdate({ target: schema.accountantListings.tenantId, set: row })
      .returning(LISTING_COLUMNS);
    this.cache = null;
    return saved;
  }

  /** Takes the listing off the page at once; saving again re-submits it. */
  async withdraw(db: TenantDb, tenantId: string) {
    const [saved] = await db
      .update(schema.accountantListings)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(eq(schema.accountantListings.tenantId, tenantId))
      .returning(LISTING_COLUMNS);
    if (!saved) throw new NotFoundException("listing_not_found");
    this.cache = null;
    return saved;
  }

  async remove(db: TenantDb, tenantId: string) {
    await db.delete(schema.accountantListings).where(eq(schema.accountantListings.tenantId, tenantId));
    this.cache = null;
    return { ok: true };
  }

  /** Approved listings, filtered. A one-minute memo keeps a crawl of filter links off the database. */
  async listPublic(filter: { region?: string; service?: string }): Promise<PublicListing[]> {
    if (!this.cache || Date.now() - this.cache.at > 60_000) {
      const rows = await this.dbService.db.execute<PublicListingRow>(sql`SELECT * FROM public_accountant_listings()`);
      this.cache = { at: Date.now(), rows: [...rows].map(toPublicListing) };
    }
    return filterListings(this.cache.rows, filter);
  }

  async listForReview(status?: string) {
    const known = ["pending", "approved", "rejected", "withdrawn"].includes(status ?? "") ? status! : null;
    const rows = await this.dbService.db.execute(sql`SELECT * FROM admin_accountant_listings(${known})`);
    return [...rows];
  }

  async review(id: string, status: "approved" | "rejected", note: string | null | undefined, updatedAt: string) {
    const rows = await this.dbService.db.execute<{ ok: boolean }>(
      sql`SELECT review_accountant_listing(${id}::uuid, ${status}, ${note ?? null}, ${updatedAt}::timestamptz) AS ok`,
    );
    // False: unknown id, withdrawn meanwhile, or edited since the admin loaded it.
    if (![...rows][0]?.ok) throw new ConflictException("listing_changed");
    this.cache = null;
    return { ok: true };
  }
}
