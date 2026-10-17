import { z } from "zod";

/**
 * Regions are ISO 3166-2 codes: the 14 Czech and 8 Slovak kraje. Codes, not
 * names, so the page translates them and a filter link is the same in
 * every locale.
 */
export const LISTING_REGIONS = [
  "CZ-10", "CZ-20", "CZ-31", "CZ-32", "CZ-41", "CZ-42", "CZ-51", "CZ-52", "CZ-53", "CZ-63", "CZ-64", "CZ-71", "CZ-72", "CZ-80",
  "SK-BL", "SK-TA", "SK-TC", "SK-NI", "SK-ZI", "SK-BC", "SK-PV", "SK-KI",
] as const;

export const LISTING_SERVICES = ["bookkeeping", "tax_records", "tax_return", "vat", "payroll", "annual_accounts", "advisory", "startup"] as const;

export const LISTING_LANGUAGES = ["cs", "sk", "en", "de", "uk", "pl", "ru", "vi"] as const;

export type ListingRegion = (typeof LISTING_REGIONS)[number];
export type ListingService = (typeof LISTING_SERVICES)[number];

/** Empty strings from the form become null; whitespace runs collapse. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => v.replace(/\s+/g, " ").trim().slice(0, max))
    .transform((v) => (v ? v : null))
    .nullish();

const website = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => !v || /^https?:\/\/[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$/i.test(v), "invalid_website")
  .transform((v) => (v ? v : null))
  .nullish();

/** Unique values in the canonical order of `all`, so the stored array is stable. */
const subset = <T extends string>(all: readonly T[]) =>
  z.array(z.enum(all as unknown as [T, ...T[]])).max(all.length).transform((v) => all.filter((x) => v.includes(x)));

export const saveListingSchema = z
  .object({
    displayName: z
      .string()
      .transform((v) => v.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(2).max(120)),
    bio: z
      .string()
      .max(1200)
      .transform((v) => v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 600))
      .transform((v) => (v ? v : null))
      .nullish(),
    regions: subset(LISTING_REGIONS),
    remote: z.boolean().default(false),
    services: subset(LISTING_SERVICES).refine((v) => v.length > 0, "services_required"),
    languages: subset(LISTING_LANGUAGES).refine((v) => v.length > 0, "languages_required"),
    priceHint: optionalText(80),
    contactEmail: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v ? v.toLowerCase() : null))
      .pipe(z.string().email().nullable())
      .nullish(),
    website,
  })
  .refine((v) => v.regions.length > 0 || v.remote, { message: "region_required", path: ["regions"] })
  .refine((v) => Boolean(v.contactEmail || v.website), { message: "contact_required", path: ["contactEmail"] });

export type SaveListingInput = z.input<typeof saveListingSchema>;
export type ListingValues = z.output<typeof saveListingSchema>;

export interface PublicListingRow {
  id: string;
  display_name: string;
  bio: string | null;
  regions: string[] | null;
  remote: boolean;
  services: string[] | null;
  languages: string[] | null;
  price_hint: string | null;
  contact_email: string | null;
  website: string | null;
  profile_slug: string | null;
}

export interface PublicListing {
  id: string;
  name: string;
  bio: string | null;
  regions: ListingRegion[];
  remote: boolean;
  services: ListingService[];
  languages: string[];
  priceHint: string | null;
  contactEmail: string | null;
  website: string | null;
  profileSlug: string | null;
}

const known = <T extends string>(all: readonly T[], values: string[] | null): T[] => (values ?? []).filter((v): v is T => (all as readonly string[]).includes(v));

export function toPublicListing(row: PublicListingRow): PublicListing {
  return {
    id: row.id,
    name: row.display_name,
    bio: row.bio,
    regions: known(LISTING_REGIONS, row.regions),
    remote: row.remote,
    services: known(LISTING_SERVICES, row.services),
    languages: known(LISTING_LANGUAGES, row.languages),
    priceHint: row.price_hint,
    contactEmail: row.contact_email,
    website: row.website,
    profileSlug: row.profile_slug,
  };
}

/**
 * The page's filters. An unknown region or service is ignored rather than
 * returning nothing, so a stale link still shows the directory. A remote
 * accountant matches every region of its own country: "online, celá ČR"
 * serves a client in Brno as well as one in Prague.
 */
export function filterListings(listings: PublicListing[], filter: { region?: string; service?: string }): PublicListing[] {
  const region = (LISTING_REGIONS as readonly string[]).includes(filter.region ?? "") ? (filter.region as ListingRegion) : undefined;
  const service = (LISTING_SERVICES as readonly string[]).includes(filter.service ?? "") ? (filter.service as ListingService) : undefined;
  return listings.filter((l) => {
    if (service && !l.services.includes(service)) return false;
    if (!region) return true;
    if (l.regions.includes(region)) return true;
    const country = region.slice(0, 2);
    return l.remote && (l.regions.length === 0 || l.regions.some((r) => r.startsWith(country)));
  });
}
