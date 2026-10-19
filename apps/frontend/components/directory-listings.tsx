import { Building2, MapPin } from 'lucide-react';
import { logoUrl, type DirectoryListing } from '@/lib/business-directory';
import { getMunicipalityBySlug } from '@/lib/municipalities';
import { profileUrl, SITE_URL } from '@/lib/site';

/**
 * Cards of listed public profiles (directory and town pages). Only what the
 * owner agreed to show in the directory: name, tagline, trade, town, logo.
 * Profile links are plain <a>: with PROFILE_DOMAIN they leave the site.
 */
export function DirectoryListings({
  listings,
  locale,
  tradeLabel,
  showTown = true
}: {
  listings: DirectoryListing[];
  locale: string;
  tradeLabel: (trade: DirectoryListing['trade']) => string;
  showTown?: boolean;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {listings.map((l) => {
        const town = getMunicipalityBySlug(l.town);
        return (
          <li key={l.slug}>
            <a href={profileUrl(l.slug, locale)} className="flex h-full min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary">
              {l.hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl(l)} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg border border-border bg-white object-contain p-1" />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block break-words font-semibold text-foreground">{l.name}</span>
                {l.tagline && <span className="mt-0.5 line-clamp-2 block break-words text-sm text-muted-foreground">{l.tagline}</span>}
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5">{tradeLabel(l.trade)}</span>
                  {showTown && town && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {town.name}
                    </span>
                  )}
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** ItemList of LocalBusiness nodes for a directory page: only the fields the cards show. */
export function directoryItemListLd(name: string, path: string, locale: string, listings: DirectoryListing[], tradeLabel: (trade: DirectoryListing['trade']) => string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    url: `${SITE_URL}/${locale}${path}`,
    numberOfItems: listings.length,
    itemListElement: listings.map((l, i) => {
      const town = getMunicipalityBySlug(l.town);
      return {
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'LocalBusiness',
          name: l.name,
          url: profileUrl(l.slug, locale),
          ...(l.tagline ? { description: l.tagline } : {}),
          ...(l.hasLogo ? { logo: `${SITE_URL}${logoUrl(l)}` } : {}),
          knowsAbout: tradeLabel(l.trade),
          ...(town ? { address: { '@type': 'PostalAddress', addressLocality: town.name, addressCountry: town.country } } : {})
        }
      };
    })
  };
}
