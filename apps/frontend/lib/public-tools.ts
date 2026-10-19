import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, BookOpenCheck, Building2, Calculator, CalendarClock, FileCode2, FileMinus2, FileText, Globe2, HandCoins, Landmark, Percent, QrCode, Receipt, Repeat, Scale, Wallet } from 'lucide-react';
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
  // Slovak rules, so unlike the Czech one it is published in Slovak too.
  { slug: 'slovak-self-employed-tax', key: 'szco', icon: Calculator, locales: ALL },
  { slug: 'flat-tax', key: 'flatTax', icon: Scale, locales: CZ_ONLY },
  { slug: 'vat', key: 'vat', icon: Percent, locales: ALL },
  { slug: 'minimum-advances', key: 'minimums', icon: Wallet, locales: ALL },
  { slug: 'cnb-exchange-rates', key: 'fx', icon: ArrowLeftRight, locales: ALL },
  // Invoice helpers. QR Platba and the domestic account format are Czech; the
  // company lookup searches RPO and VIES as well as ARES, and the due date
  // knows Slovak holidays too.
  { slug: 'qr-payment', key: 'qrPayment', icon: QrCode, locales: CZ_ONLY },
  { slug: 'company-lookup', key: 'companyLookup', icon: Building2, locales: ALL },
  { slug: 'iban', key: 'iban', icon: Landmark, locales: CZ_ONLY },
  { slug: 'due-date', key: 'dueDate', icon: CalendarClock, locales: ALL }
] as const satisfies readonly PublicTool[];

export const GUIDES = [
  { slug: 'vat-return-control-statement', key: 'vatFiling', icon: BookOpenCheck, locales: CZ_ONLY },
  { slug: 'identified-person', key: 'identified', icon: Globe2, locales: CZ_ONLY },
  // Slovak rules, so published in Slovak (primary) as well as cs and en for
  // Czech companies that invoice Slovak customers.
  { slug: 'e-invoicing-slovakia-2027', key: 'skEinvoicing', icon: FileCode2, locales: ALL }
] as const satisfies readonly PublicTool[];

/**
 * Invoice templates (`/invoice-templates/<slug>`): a rendered sample, the
 * required fields with links to the law, and a button that opens
 * `/create-invoice?template=<slug>` preset for that document. Published in
 * every language: the cs and en pages follow Czech law, the sk page Slovak
 * law (the sample data and rule references live in the message files).
 */
export const TEMPLATES = [
  { slug: 'non-vat-payer', key: 'nonPayer', icon: FileText, locales: ALL },
  { slug: 'vat-payer', key: 'vatPayer', icon: Receipt, locales: ALL },
  { slug: 'proforma-invoice', key: 'proforma', icon: HandCoins, locales: ALL },
  { slug: 'credit-note', key: 'creditNote', icon: FileMinus2, locales: ALL },
  { slug: 'reverse-charge', key: 'reverseCharge', icon: Repeat, locales: ALL },
  { slug: 'identified-person', key: 'identified', icon: Globe2, locales: ALL }
] as const satisfies readonly PublicTool[];

export type Calculator = (typeof CALCULATORS)[number];
export type Guide = (typeof GUIDES)[number];
export type InvoiceTemplate = (typeof TEMPLATES)[number];

/** The guides hub exists in every language at least one guide is published in. */
export const GUIDES_HUB_LOCALES: readonly string[] = ALL.filter((l) => GUIDES.some((g) => (g.locales as readonly string[]).includes(l)));

export function getCalculator(slug: string): Calculator | undefined {
  return CALCULATORS.find((c) => c.slug === slug);
}

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export function getTemplate(slug: string): InvoiceTemplate | undefined {
  return TEMPLATES.find((x) => x.slug === slug);
}

export function isPublishedIn(tool: { locales: readonly string[] }, locale: string): boolean {
  return tool.locales.includes(locale);
}

/**
 * Calculators that also run inside the app, prefilled with the company's
 * own numbers (`/dashboard/calculators/<slug>`). Same component as the
 * public page; the public page links there for a signed-in visitor.
 */
const IN_APP_CALCULATORS: readonly string[] = ['flat-tax'];

export function inAppCalculatorPath(slug: string): string | null {
  return IN_APP_CALCULATORS.includes(slug) ? `/dashboard/calculators/${slug}` : null;
}
