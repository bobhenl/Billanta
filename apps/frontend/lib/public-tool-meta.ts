import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isPublishedIn, type PublicTool } from '@/lib/public-tools';
import { publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Metadata for a calculator or guide page (or a hub with a locale list).
 *
 * Where the page is published: full public metadata, with hreflang limited
 * to the published languages. Elsewhere (the sk copy of a Czech-rules page)
 * the URL only shows the "this is about Czech rules" notice, so it is
 * `noindex,follow`: it is a pointer, not a document, and it has no
 * canonical or hreflang of its own (hreflang must never point at it, and it
 * must not claim to be an alternate of the Czech page).
 */
export async function toolPageMetadata({
  locale,
  path,
  tool,
  titleKey,
  descriptionKey
}: {
  locale: string;
  path: string;
  tool: Pick<PublicTool, 'locales'>;
  /** Full message keys, e.g. "tools.calculators.items.vat.title". */
  titleKey: string;
  descriptionKey: string;
}): Promise<Metadata> {
  const t = await getTranslations({ locale });
  const title = t(titleKey);
  const description = t(descriptionKey);
  if (!isPublishedIn(tool, locale)) {
    return { title, description, robots: { index: false, follow: true } };
  }
  return publicPageMetadata({ locale, path, title, description, locales: tool.locales });
}

/**
 * "2026-10-17" as an ISO timestamp with the Prague offset of that day
 * (+01:00 or +02:00). Article markup needs a timezone; a bare date is the
 * most common reason it is rejected.
 */
export function pragueDateTime(date: string): string {
  const noon = new Date(`${date}T12:00:00Z`);
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', timeZoneName: 'longOffset' })
      .formatToParts(noon)
      .find((p) => p.type === 'timeZoneName')
      ?.value.replace('GMT', '') || '+01:00';
  return `${date}T00:00:00${offset}`;
}

/** Article node for a guide: only what the page itself shows (title, lead, the "updated" date). */
export function guideArticleLd(locale: string, path: string, headline: string, description: string, checked: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    inLanguage: locale,
    dateModified: pragueDateTime(checked),
    mainEntityOfPage: `${SITE_URL}/${locale}${path}`,
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL }
  };
}
