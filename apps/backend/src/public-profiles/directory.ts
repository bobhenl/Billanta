import { DIRECTORY_TRADES, SLUG_PATTERN, TOWN_SLUG_PATTERN, type DirectoryTrade } from "../tenants/public-profile";

// `type`, not `interface` – see the note in public-invoices.service.ts.
export type DirectoryRow = {
  slug: string | null;
  company_name: string;
  tagline: string | null;
  trade: string | null;
  town: string | null;
  city: string | null;
  country: string;
  has_logo: boolean;
};

/** One listed profile, as the directory and town pages show it. Nothing the profile page doesn't show already. */
export interface DirectoryListing {
  slug: string;
  name: string;
  tagline: string | null;
  trade: DirectoryTrade;
  town: string;
  /** The address city, only when the owner shows the address on the profile. */
  city: string | null;
  country: string;
  hasLogo: boolean;
}

const isTrade = (v: string | null | undefined): v is DirectoryTrade => (DIRECTORY_TRADES as readonly string[]).includes(v ?? "");

/** Drops rows a hand-edited jsonb could still slip past the SQL (bad slug, unknown trade). */
export function toDirectoryListing(row: DirectoryRow): DirectoryListing | null {
  const slug = row.slug?.toLowerCase() ?? "";
  const town = row.town?.toLowerCase() ?? "";
  if (!SLUG_PATTERN.test(slug) || !TOWN_SLUG_PATTERN.test(town) || !isTrade(row.trade)) return null;
  return {
    slug,
    name: row.company_name,
    tagline: row.tagline?.trim() || null,
    trade: row.trade,
    town,
    city: row.city?.trim() || null,
    country: row.country,
    hasLogo: row.has_logo,
  };
}

/**
 * `?trade=` and `?town=`. Unlike the accountant filters, an unknown value
 * matches nothing: a directory page for a trade or town that doesn't exist
 * must come out empty (and noindex), not list everyone.
 */
export function filterDirectory(listings: DirectoryListing[], filter: { trade?: string; town?: string }): DirectoryListing[] {
  const trade = filter.trade?.trim().toLowerCase();
  const town = filter.town?.trim().toLowerCase();
  if (trade && !isTrade(trade)) return [];
  if (town && !TOWN_SLUG_PATTERN.test(town)) return [];
  return listings.filter((l) => (!trade || l.trade === trade) && (!town || l.town === town));
}
