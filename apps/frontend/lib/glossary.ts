import { routing } from '@/i18n/routing';

/**
 * Public glossary (/glossary and /glossary/[slug]): one short page per term.
 *
 * Slugs are English and the same in every language. A term belongs to a
 * market:
 * - `both`: the idea exists in both countries. The cs page explains Czech
 *   law, the sk page Slovak law, the en page both. Indexed in all languages.
 * - `cz` / `sk`: a term of one country only (DUZP, kontrolný výkaz …). The
 *   page is written in that country's language and in English; it is indexed
 *   only in that country's language, like the town pages. The other national
 *   language shows a pointer to the original and to the `counterpart`, and
 *   the en copy stays readable but noindex,follow.
 *
 * Law references go through `lawUrl` of @faktur/cz-compliance ("§21 ZDPH"),
 * never as hand-written URLs. Facts with a number come either from the
 * compliance data or from the linked paragraph.
 *
 * The texts are in lib/glossary-content/{cs,sk,en}.ts rather than in the
 * message files: they are long, per-market, and a Czech-only term has no
 * Slovak text at all, which next-intl's "same keys in every locale" rule
 * would not allow.
 */

export type GlossaryMarket = 'cz' | 'sk' | 'both';

/**
 * A page the term page links to. `calculator`, `guide` and `feature` are
 * slugs of the existing registries (name from their messages, hidden where
 * that page is not published); `page` is for other routes (e.g. invoice
 * templates or the tax calendar once they exist) with its label in
 * `glossaryPages.tools.<labelKey>`.
 */
export type GlossaryTool =
  | { kind: 'calculator' | 'guide' | 'feature'; slug: string }
  | { kind: 'page'; href: string; labelKey: string };

export interface GlossaryTerm {
  slug: string;
  market: GlossaryMarket;
  /** Law references for lawUrl, Czech and Slovak in separate lists so each page shows its own. */
  laws: { cz?: string[]; sk?: string[] };
  related: string[];
  tools: GlossaryTool[];
  /** The other country's term for the same idea (only for `cz` / `sk` terms). */
  counterpart?: string;
}

const calc = (slug: string): GlossaryTool => ({ kind: 'calculator', slug });
const guide = (slug: string): GlossaryTool => ({ kind: 'guide', slug });
const feature = (slug: string): GlossaryTool => ({ kind: 'feature', slug });

const VAT_CALC = calc('vat');
const FX_CALC = calc('cnb-exchange-rates');
const DUE_CALC = calc('due-date');
const VAT_GUIDE = guide('vat-return-control-statement');
const ID_GUIDE = guide('identified-person');
const REQUIRED = feature('required-fields-check');
const CREATE_INVOICE: GlossaryTool = { kind: 'page', href: '/create-invoice', labelKey: 'createInvoice' };

export const GLOSSARY: readonly GlossaryTerm[] = [
  // Shared terms (both countries).
  {
    slug: 'vat-payer',
    market: 'both',
    laws: { cz: ['§6 ZDPH', '§94 ZDPH'], sk: ['§4 ZoDPH'] },
    related: ['vat-rate', 'vat-return', 'identified-person', 'section-7a-registration', 'dic'],
    tools: [VAT_CALC, VAT_GUIDE]
  },
  {
    slug: 'vat-rate',
    market: 'both',
    laws: { cz: ['§47 ZDPH'], sk: ['§27 ZoDPH'] },
    related: ['vat-payer', 'tax-base', 'reverse-charge'],
    tools: [VAT_CALC]
  },
  {
    slug: 'tax-base',
    market: 'both',
    laws: { cz: ['§36 ZDPH'], sk: ['§22 ZoDPH'] },
    related: ['vat-rate', 'exchange-rate', 'credit-note'],
    tools: [VAT_CALC]
  },
  {
    slug: 'invoice',
    market: 'both',
    laws: { cz: ['§435 OZ', '§28 ZDPH', '§29 ZDPH'], sk: ['§3a ObZ', '§71 ZoDPH', '§74 ZoDPH'] },
    related: ['tax-document', 'invoice-number', 'due-date', 'advance-invoice', 'credit-note', 'e-invoice'],
    tools: [CREATE_INVOICE, REQUIRED]
  },
  {
    slug: 'invoice-number',
    market: 'both',
    laws: { cz: ['§29/1 ZDPH'], sk: ['§74/1 ZoDPH'] },
    related: ['invoice', 'variable-symbol', 'tax-document'],
    tools: [CREATE_INVOICE, REQUIRED]
  },
  {
    slug: 'advance-invoice',
    market: 'both',
    laws: { cz: ['§20a ZDPH', '§28 ZDPH'], sk: ['§19/4 ZoDPH', '§71 ZoDPH'] },
    related: ['invoice', 'tax-document', 'taxable-supply-date', 'delivery-date'],
    tools: [feature('quotes-and-proforma-invoices')]
  },
  {
    slug: 'credit-note',
    market: 'both',
    laws: { cz: ['§42 ZDPH', '§45 ZDPH'], sk: ['§25 ZoDPH', '§71/2 ZoDPH'] },
    related: ['invoice', 'tax-document', 'tax-base'],
    tools: [CREATE_INVOICE]
  },
  {
    slug: 'reverse-charge',
    market: 'both',
    laws: { cz: ['§92a ZDPH', '§92e ZDPH'], sk: ['§69 ZoDPH', '§69/12 ZoDPH'] },
    related: ['vat-payer', 'control-statement', 'recapitulative-statement', 'identified-person', 'vies'],
    tools: [VAT_GUIDE, ID_GUIDE, REQUIRED]
  },
  {
    slug: 'recapitulative-statement',
    market: 'both',
    laws: { cz: ['§102 ZDPH'], sk: ['§80 ZoDPH'] },
    related: ['vat-return', 'control-statement', 'reverse-charge', 'vies'],
    tools: [VAT_GUIDE]
  },
  {
    slug: 'vat-return',
    market: 'both',
    laws: { cz: ['§101 ZDPH'], sk: ['§78 ZoDPH'] },
    related: ['tax-period', 'control-statement', 'sk-control-statement', 'recapitulative-statement'],
    tools: [VAT_GUIDE, feature('vat-returns-epo')]
  },
  {
    slug: 'tax-period',
    market: 'both',
    laws: { cz: ['§99 ZDPH', '§99a ZDPH'], sk: ['§77 ZoDPH'] },
    related: ['vat-return', 'vat-payer'],
    tools: [VAT_GUIDE]
  },
  {
    slug: 'oss',
    market: 'both',
    laws: { cz: ['§110a ZDPH', '§110l ZDPH'], sk: ['§68 ZoDPH', '§68b ZoDPH'] },
    related: ['vat-rate', 'vat-payer', 'vat-return'],
    tools: [VAT_CALC]
  },
  {
    slug: 'e-invoice',
    market: 'both',
    laws: { cz: ['§26/3 ZDPH'], sk: ['§71/1 ZoDPH'] },
    related: ['isdoc', 'peppol', 'sk-e-invoicing-2027', 'invoice'],
    tools: [feature('isdoc')]
  },
  {
    slug: 'peppol',
    market: 'both',
    laws: {},
    related: ['e-invoice', 'sk-e-invoicing-2027', 'isdoc'],
    tools: [feature('isdoc')]
  },
  {
    slug: 'variable-symbol',
    market: 'both',
    laws: {},
    related: ['invoice-number', 'iban', 'qr-payment'],
    tools: [calc('qr-payment'), feature('payment-matching')]
  },
  {
    slug: 'due-date',
    market: 'both',
    laws: { cz: ['§1958 OZ', '§1963 OZ'], sk: ['§340a ObZ'] },
    related: ['late-payment-interest', 'invoice', 'variable-symbol'],
    tools: [DUE_CALC, feature('payment-reminders')]
  },
  {
    slug: 'late-payment-interest',
    market: 'both',
    laws: { cz: ['§1970 OZ'], sk: ['§369 ObZ'] },
    related: ['due-date', 'invoice'],
    tools: [DUE_CALC, feature('payment-reminders')]
  },
  {
    slug: 'iban',
    market: 'both',
    laws: {},
    related: ['qr-payment', 'variable-symbol'],
    tools: [calc('iban'), calc('qr-payment')]
  },
  {
    slug: 'qr-payment',
    market: 'both',
    laws: {},
    related: ['iban', 'variable-symbol', 'invoice'],
    tools: [calc('qr-payment'), feature('qr-payments')]
  },
  {
    slug: 'vies',
    market: 'both',
    laws: {},
    related: ['dic', 'ic-dph', 'reverse-charge', 'recapitulative-statement'],
    tools: [calc('company-lookup')]
  },
  {
    slug: 'exchange-rate',
    market: 'both',
    laws: { cz: ['§4/8 ZDPH'], sk: ['§26/1 ZoDPH'] },
    related: ['tax-base', 'invoice'],
    tools: [FX_CALC, feature('foreign-currency-invoices')]
  },
  {
    slug: 'dic',
    market: 'both',
    laws: {},
    related: ['ico', 'ic-dph', 'vat-payer', 'vies'],
    tools: [calc('company-lookup')]
  },
  {
    slug: 'ico',
    market: 'both',
    laws: {},
    related: ['dic', 'ic-dph', 'invoice'],
    tools: [calc('company-lookup'), feature('company-lookup-ares')]
  },
  {
    slug: 'flat-rate-expenses',
    market: 'both',
    laws: { cz: ['§7/7 ZDP'], sk: ['§6/10 ZoDP'] },
    related: ['self-employed', 'szco', 'flat-tax'],
    tools: [calc('self-employed-tax'), calc('slovak-self-employed-tax')]
  },

  // Czech terms.
  {
    slug: 'taxable-supply-date',
    market: 'cz',
    laws: { cz: ['§20a ZDPH', '§21 ZDPH', '§28/8 ZDPH'] },
    related: ['tax-document', 'advance-invoice', 'vat-return'],
    tools: [CREATE_INVOICE, REQUIRED],
    counterpart: 'delivery-date'
  },
  {
    slug: 'tax-document',
    market: 'cz',
    laws: { cz: ['§26 ZDPH', '§28 ZDPH', '§29 ZDPH'] },
    related: ['invoice', 'simplified-tax-document', 'taxable-supply-date', 'credit-note'],
    tools: [CREATE_INVOICE, REQUIRED],
    counterpart: 'invoice'
  },
  {
    slug: 'simplified-tax-document',
    market: 'cz',
    laws: { cz: ['§30 ZDPH'] },
    related: ['tax-document', 'invoice', 'control-statement'],
    tools: [CREATE_INVOICE]
  },
  {
    slug: 'control-statement',
    market: 'cz',
    laws: { cz: ['§101c ZDPH', '§101e ZDPH'] },
    related: ['vat-return', 'recapitulative-statement', 'reverse-charge', 'tax-period'],
    tools: [VAT_GUIDE, feature('vat-returns-epo')],
    counterpart: 'sk-control-statement'
  },
  {
    slug: 'identified-person',
    market: 'cz',
    laws: { cz: ['§6g ZDPH', '§6h ZDPH', '§6i ZDPH'] },
    related: ['vat-payer', 'reverse-charge', 'recapitulative-statement'],
    tools: [ID_GUIDE],
    counterpart: 'section-7a-registration'
  },
  {
    slug: 'flat-tax',
    market: 'cz',
    laws: { cz: ['§2a ZDP', '§7a ZDP'] },
    related: ['self-employed', 'flat-rate-expenses'],
    tools: [calc('flat-tax')]
  },
  {
    slug: 'isdoc',
    market: 'cz',
    laws: {},
    related: ['e-invoice', 'peppol'],
    tools: [feature('isdoc')],
    counterpart: 'sk-e-invoicing-2027'
  },
  {
    slug: 'unreliable-payer',
    market: 'cz',
    laws: { cz: ['§106a ZDPH', '§109 ZDPH'] },
    related: ['vat-payer', 'dic', 'iban'],
    tools: [calc('company-lookup')]
  },
  {
    slug: 'self-employed',
    market: 'cz',
    laws: { cz: ['§7 ZDP'] },
    related: ['flat-tax', 'flat-rate-expenses', 'ico'],
    tools: [calc('self-employed-tax'), calc('minimum-advances')],
    counterpart: 'szco'
  },
  {
    slug: 'data-box',
    market: 'cz',
    laws: {},
    related: ['vat-return', 'control-statement'],
    tools: [feature('vat-returns-epo')]
  },

  // Slovak terms.
  {
    slug: 'delivery-date',
    market: 'sk',
    laws: { sk: ['§19 ZoDPH', '§73 ZoDPH'] },
    related: ['invoice', 'advance-invoice', 'vat-return'],
    tools: [CREATE_INVOICE, REQUIRED],
    counterpart: 'taxable-supply-date'
  },
  {
    slug: 'ic-dph',
    market: 'sk',
    laws: { sk: ['§4 ZoDPH', '§7a ZoDPH'] },
    related: ['dic', 'ico', 'vat-payer', 'vies'],
    tools: [calc('company-lookup')],
    counterpart: 'dic'
  },
  {
    slug: 'sk-control-statement',
    market: 'sk',
    laws: { sk: ['§78a ZoDPH'] },
    related: ['vat-return', 'recapitulative-statement', 'reverse-charge'],
    tools: [],
    counterpart: 'control-statement'
  },
  {
    slug: 'section-7a-registration',
    market: 'sk',
    laws: { sk: ['§7a ZoDPH'] },
    related: ['ic-dph', 'reverse-charge', 'recapitulative-statement'],
    tools: [],
    counterpart: 'identified-person'
  },
  {
    slug: 'sk-e-invoicing-2027',
    market: 'sk',
    laws: { sk: ['§85o ZoDPH', '§76a ZoDPH'] },
    related: ['e-invoice', 'peppol', 'invoice'],
    tools: [feature('isdoc')],
    counterpart: 'isdoc'
  },
  {
    slug: 'szco',
    market: 'sk',
    laws: { sk: ['§6 ZoDP'] },
    related: ['flat-rate-expenses', 'ico', 'ic-dph'],
    tools: [calc('slovak-self-employed-tax'), calc('minimum-advances')],
    counterpart: 'self-employed'
  }
];

export function getGlossaryTerm(slug: string): GlossaryTerm | undefined {
  return GLOSSARY.find((t) => t.slug === slug);
}

/** Languages a term is indexed in (hreflang targets, sitemap). */
export function glossaryLocales(term: Pick<GlossaryTerm, 'market'>): readonly string[] {
  if (term.market === 'cz') return ['cs'];
  if (term.market === 'sk') return ['sk'];
  return routing.locales;
}

/** Languages the term has a full text in (en always; the term's own country language). */
export function glossaryHasText(term: Pick<GlossaryTerm, 'market'>, locale: string): boolean {
  if (locale === 'en' || term.market === 'both') return true;
  return (term.market === 'cz' && locale === 'cs') || (term.market === 'sk' && locale === 'sk');
}

/** The market whose law a page in `locale` explains (en: null = both). */
export function localeMarket(locale: string): 'cz' | 'sk' | null {
  return locale === 'cs' ? 'cz' : locale === 'sk' ? 'sk' : null;
}

/** Terms a hub in `locale` lists: that country's and the shared ones (en: all). */
export function glossaryTermsFor(locale: string): GlossaryTerm[] {
  const market = localeMarket(locale);
  return GLOSSARY.filter((t) => market === null || t.market === 'both' || t.market === market);
}
