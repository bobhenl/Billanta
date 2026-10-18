import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, BookOpenCheck, Building2, Calculator, CalendarClock, Globe2, Landmark, Percent, QrCode, Scale, Wallet } from 'lucide-react';
import { routing } from '@/i18n/routing';

/**
 * Public calculators (`/calculators/<slug>`) and guides (`/guides/<slug>`).
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
 * Czech version and the Slovak authority. Slugs are English in every locale,
 * same as `/features` and `/invoicing`.
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
  { slug: 'self-employed-tax', key: 'osvc', icon: Calculator, locales: CZ_ONLY },
  { slug: 'flat-tax', key: 'flatTax', icon: Scale, locales: CZ_ONLY },
  { slug: 'vat', key: 'vat', icon: Percent, locales: ALL },
  { slug: 'minimum-advances', key: 'minimums', icon: Wallet, locales: ALL },
  { slug: 'cnb-exchange-rates', key: 'fx', icon: ArrowLeftRight, locales: ALL },
  // Invoice helpers. QR Platba, ARES and the domestic account format are Czech;
  // the due date knows Slovak holidays too.
  { slug: 'qr-payment', key: 'qrPayment', icon: QrCode, locales: CZ_ONLY },
  { slug: 'company-lookup', key: 'companyLookup', icon: Building2, locales: CZ_ONLY },
  { slug: 'iban', key: 'iban', icon: Landmark, locales: CZ_ONLY },
  { slug: 'due-date', key: 'dueDate', icon: CalendarClock, locales: ALL }
] as const satisfies readonly PublicTool[];

export const GUIDES = [
  { slug: 'vat-return-control-statement', key: 'vatFiling', icon: BookOpenCheck, locales: CZ_ONLY },
  { slug: 'identified-person', key: 'identified', icon: Globe2, locales: CZ_ONLY }
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
