import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';
import { getTranslations } from 'next-intl/server';
import { PRIVATE_CARD, SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Fallback social preview, a static file (public/og.png). Public pages get
 * their own card from `ogImage()` instead. A page-level `openGraph` object
 * replaces the parent's wholesale in Next, so every page must pass the image
 * itself.
 */
export const OG_IMAGE = { url: '/og.png', width: 1200, height: 630, alt: SITE_NAME };

/** The page's own card, drawn by app/og/[locale]/[[...path]] (see lib/og-card.ts). */
export function ogImage(locale: string, path: string, alt: string) {
  return { url: `/og/${locale}${path === '/' ? '' : path}`, width: 1200, height: 630, alt };
}

/**
 * Canonical + hreflang for one locale-less path (e.g. "/" or "/pricing").
 * Every public page should emit both in its <head> — the sitemap carries
 * the same alternates, but Google recommends the in-page tags as well.
 *
 * `locales` narrows the alternates for a page published in some languages
 * only (see lib/public-tools.ts): hreflang must never point at a copy that
 * is noindex. x-default stays the default locale when it is among them.
 */
export function localeAlternates(
  locale: string,
  path: string,
  locales: readonly string[] = routing.locales
): NonNullable<Metadata['alternates']> {
  const suffix = path === '/' ? '' : path;
  const languages: Record<string, string> = {};
  for (const l of locales) {
    languages[l] = `${SITE_URL}/${l}${suffix}`;
  }
  const fallback = locales.includes(routing.defaultLocale) ? routing.defaultLocale : locales[0];
  languages['x-default'] = `${SITE_URL}/${fallback}${suffix}`;
  return { canonical: `${SITE_URL}/${locale}${suffix}`, languages };
}

/**
 * Full metadata for an indexable public page: title, description,
 * canonical, hreflang, Open Graph and Twitter card all derived from the
 * same three inputs so they can never disagree with each other.
 */
export function publicPageMetadata({
  locale,
  path,
  title,
  description,
  locales
}: {
  locale: string;
  path: string;
  /** Languages the page is published in (default: all), for hreflang. */
  locales?: readonly string[];
  /** As shown in the tab (the layout appends the brand); `absolute` skips that. */
  title?: string | { absolute: string };
  description: string;
}): Metadata {
  const alternates = localeAlternates(locale, path, locales);
  const social = typeof title === 'string' ? title : title?.absolute;
  const image = ogImage(locale, path, social ?? SITE_NAME);
  return {
    ...(title ? { title } : {}),
    description,
    alternates,
    openGraph: {
      ...(social ? { title: social } : {}),
      description,
      url: alternates.canonical as string,
      siteName: SITE_NAME,
      locale,
      type: 'website',
      images: [image]
    },
    twitter: { card: 'summary_large_image', ...(social ? { title: social } : {}), description, images: [image.url] }
  };
}

/** For pages that must never be indexed (auth forms, dashboard, private invoice links). */
export const NOINDEX: Metadata['robots'] = { index: false, follow: false };

/**
 * Metadata of a private token page (/i, /d, /c): never indexed, no referrer,
 * and one generic preview card (PRIVATE_CARD in lib/site.ts). A link pasted
 * into Discord, WhatsApp or Slack unfurls as "a shared document from
 * Billanta" and nothing more: no invoice number, amount, customer or
 * supplier, because whoever sees the chat is not necessarily allowed to see
 * the invoice. The page's own title stays generic for the same reason.
 */
export async function privateLinkMetadata(locale: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'og' });
  const title = t('privateTitle');
  const description = t('privateSubtitle');
  const image = ogImage(locale, `/${PRIVATE_CARD}`, title);
  return {
    title,
    description,
    robots: NOINDEX,
    referrer: 'no-referrer',
    openGraph: { title, description, siteName: SITE_NAME, locale, type: 'website', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] }
  };
}

/** Serialises JSON-LD safely for a <script> tag (no `</script>` breakout). */
export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') };
}

/** BreadcrumbList for a public page; `crumbs` are [name, locale-less path], home first. */
export function breadcrumbLd(locale: string, crumbs: [string, string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: `${SITE_URL}/${locale}${path === '/' ? '' : path}`
    }))
  };
}

/** A plain WebPage (or subtype) node tied to the site, for pages with no richer type. */
export function webPageLd(locale: string, path: string, type: string, name: string, description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': type,
    name,
    description,
    url: `${SITE_URL}/${locale}${path === '/' ? '' : path}`,
    inLanguage: locale,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL }
  };
}
