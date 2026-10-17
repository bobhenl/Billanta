import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, BookOpenCheck, Calculator, Globe2, Percent, Scale, Wallet } from 'lucide-react';
import { routing } from '@/i18n/routing';

/**
 * Public calculators (`/kalkulacky/<slug>`) and guides (`/navody/<slug>`).
 * One list feeds the pages, the sitemap, hreflang, the header menu, the
 * footer, the phone "More" panel, the site search and the OG cards, so a new
 * entry shows up everywhere at once.
 *
 * `locales` are the languages the page is published (indexed) in. Pages
 * about Czech-only rules (OSVČ insurance, paušální daň, Czech VAT filing)
 * are cs + en only: Slovakia has different rules, and a Slovak translation
 * of Czech rules would read as advice for Slovak businesses. The sk URL of
 * such a page still answers (the language switcher keeps the path) but shows
 * a short "this is about Czech rules" notice with `noindex` and links to the
 * Czech version and the Slovak authority. Slugs are Czech in every locale,
 * same as `/funkce` and `/faktury-pro`.
 */
export interface PublicTool {
  slug: string;
  key: string;
  icon: LucideIcon;
  locales: readonly string[];
}

const ALL = routing.locales;
const CZ_ONLY = ['cs', 'en'] as const;

export const CALCULATORS = [
  { slug: 'dan-a-pojisteni-osvc', key: 'osvc', icon: Calculator, locales: CZ_ONLY },
  { slug: 'pausalni-dan', key: 'flatTax', icon: Scale, locales: CZ_ONLY },
  { slug: 'dph', key: 'vat', icon: Percent, locales: ALL },
  { slug: 'minimalni-zalohy', key: 'minimums', icon: Wallet, locales: ALL },
  { slug: 'kurzy-cnb', key: 'fx', icon: ArrowLeftRight, locales: ALL }
] as const satisfies readonly PublicTool[];

export const GUIDES = [
  { slug: 'priznani-dph-kontrolni-a-souhrnne-hlaseni', key: 'vatFiling', icon: BookOpenCheck, locales: CZ_ONLY },
  { slug: 'identifikovana-osoba', key: 'identified', icon: Globe2, locales: CZ_ONLY }
] as const satisfies readonly PublicTool[];

export type Calculator = (typeof CALCULATORS)[number];
export type Guide = (typeof GUIDES)[number];

/** The guides hub only lists Czech-rule guides, so it exists where they do. */
export const GUIDES_HUB_LOCALES: readonly string[] = CZ_ONLY;

export function getCalculator(slug: string): Calculator | undefined {
  return CALCULATORS.find((c) => c.slug === slug);
}

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export function isPublishedIn(tool: { locales: readonly string[] }, locale: string): boolean {
  return tool.locales.includes(locale);
}
