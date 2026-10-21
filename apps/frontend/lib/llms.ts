import { routing } from '@/i18n/routing';
import { brandsFor, comparedPages } from '@/lib/competitors';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { GLOSSARY } from '@/lib/glossary';
import { glossaryText } from '@/lib/glossary-content';
import { BANK_TRANSFER_SURCHARGE_PERCENT, COMPARISON, formatPlanPrice, PAYG_PRICE, PLANS, type PlanCurrency } from '@/lib/plans';
import { CALCULATORS, GUIDES, GUIDES_HUB_LOCALES } from '@/lib/public-tools';
import { REFERRAL_REWARDS } from '@/lib/referral';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { staticSitemapPages } from '@/app/sitemap';
import cs from '@/messages/cs.json';
import en from '@/messages/en.json';
import sk from '@/messages/sk.json';

/**
 * llms.txt and llms-full.txt (https://llmstxt.org): plain-text maps of the
 * public site for language-model readers. Everything that changes (prices,
 * features, calculators, guides, compared brands, FAQ answers) is read from
 * the same registries and messages the pages use, so the files can't drift
 * from the site. Any page added to the sitemap's static entries and not
 * described below still shows up under "More pages".
 */

type Text = { name: string; description: string };
type Faq = { q: string; a: string }[];
type Messages = typeof en;

const MESSAGES: Record<string, Messages> = { cs: cs as Messages, sk: sk as Messages, en };
const LANGUAGE_NAMES: Record<string, string> = { cs: 'Czech', sk: 'Slovak', en: 'English' };

const url = (locale: string, path: string) => `${SITE_URL}/${locale}${path === '/' ? '' : path}`;
/** The page's first published locale, preferring the default one. */
const homeLocale = (locales: readonly string[]) => (locales.includes(routing.defaultLocale) ? routing.defaultLocale : locales[0]!);
/** Where English copy links to: the English page when there is one, so text and page match. */
const enLocale = (locales: readonly string[]) => (locales.includes('en') ? 'en' : homeLocale(locales));
const fill = (text: string, params: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));

function price(currency: PlanCurrency, value: number) {
  return formatPlanPrice(value, currency, 'en');
}

function pricingLines(): string[] {
  const plans = en.pricing.plans as Record<string, { name: string; tagline: string; features: string[] }>;
  const payg = (c: PlanCurrency) => price(c, PAYG_PRICE[c]);
  return [
    ...PLANS.map((p) => {
      const copy = plans[p.key]!;
      const cost =
        p.price.CZK.monthly === 0
          ? 'free, no time limit'
          : `${price('CZK', p.price.CZK.yearly)} / ${price('EUR', p.price.EUR.yearly)} a month billed yearly, ${price('CZK', p.price.CZK.monthly)} / ${price('EUR', p.price.EUR.monthly)} billed monthly`;
      return `- ${copy.name} (${copy.tagline}): ${cost}. ${copy.features.map((f) => fill(f, { payg: `${payg('CZK')} / ${payg('EUR')}` })).join('; ')}.`;
    }),
    '',
    `Prices exclude VAT. Card subscriptions can be cancelled any time. Paying by bank transfer against a proforma costs ${BANK_TRANSFER_SURCHARGE_PERCENT} % more and is in CZK only. Free includes 10 documents a month, then ${payg('CZK')} / ${payg('EUR')} per document. ${en.pricing.aiCreditNote}`
  ];
}

function featureLines(locale: string, detailed: boolean): string[] {
  const items = MESSAGES[locale]!.featurePages.items as Record<string, Text & { lead?: string; points?: unknown }>;
  return FEATURE_PAGES.flatMap((f) => {
    const text = items[f.key]!;
    const line = `- [${text.name}](${url(locale, `/features/${f.slug}`)}): ${text.description}`;
    if (!detailed) return [line];
    const points = Array.isArray(text.points) ? (text.points as (string | { title?: string; body?: string })[]) : [];
    return [
      line,
      ...(text.lead ? [`  ${text.lead}`] : []),
      ...points.map((p) => `  - ${typeof p === 'string' ? p : [p.title, p.body].filter(Boolean).join(': ')}`)
    ];
  });
}

function toolLines(): string[] {
  const calc = en.tools.calculators.items as Record<string, Text>;
  const guide = en.tools.guides.items as Record<string, Text>;
  return [
    `- [Calculators](${url('en', '/calculators')}): free, no sign-up`,
    ...CALCULATORS.map((c) => `  - [${calc[c.key]!.name}](${url(enLocale(c.locales), `/calculators/${c.slug}`)}): ${calc[c.key]!.description}`),
    `- [Guides](${url(enLocale(GUIDES_HUB_LOCALES), '/guides')})`,
    ...GUIDES.map((g) => `  - [${guide[g.key]!.name}](${url(enLocale(g.locales), `/guides/${g.slug}`)}): ${guide[g.key]!.description}`),
    `- [Glossary](${url(routing.defaultLocale, '/glossary')}): Czech and Slovak invoicing and VAT terms, each with a definition, an example and the law`,
    ...GLOSSARY.map((term) => {
      const text = glossaryText('en', term.slug)!;
      return `  - [${text.term}](${url(term.market === 'sk' ? 'sk' : routing.defaultLocale, `/glossary/${term.slug}`)}): ${text.definition}`;
    })
  ];
}

function compareLines(): string[] {
  return [
    `- [Comparison with other invoicing apps](${url(routing.defaultLocale, '/compare')}): features and prices side by side, with the date they were checked`,
    ...comparedPages().map(({ key, locales }) => {
      const l = homeLocale(locales);
      const name = brandsFor(l).find((b) => b.key === key)?.name ?? key;
      return `  - [${SITE_NAME} vs ${name}](${url(l, `/compare/${key}`)})`;
    })
  ];
}

const MAIN_PAGES: [path: string, label: string][] = [
  ['/', 'Home: what the product does, how it works, FAQ'],
  ['/pricing', 'Pricing: plans, plan comparison table, pricing FAQ'],
  ['/create-invoice', 'Invoice without sign-up: free one-off PDF invoice with QR payment code, nothing stored'],
  ['/dictate-invoice', 'Dictate an invoice: say who and what you are invoicing, the guest form fills itself in, no sign-up'],
  ['/demo', 'Demo: try the app with sample data, no account'],
  ['/features', 'Features: one page per feature'],
  ['/for-accountants', 'For accountants: free access to clients’ companies, exports for accounting software'],
  ['/about', 'About: who it is for and why it exists'],
  ['/invoicing', 'Invoicing by municipality: Czech and Slovak towns']
];

function described(): Set<string> {
  return new Set([
    ...MAIN_PAGES.map(([p]) => p),
    '/compare',
    ...comparedPages().map((b) => `/compare/${b.key}`),
    ...FEATURE_PAGES.map((f) => `/features/${f.slug}`),
    '/calculators',
    ...CALCULATORS.map((c) => `/calculators/${c.slug}`),
    '/guides',
    ...GUIDES.map((g) => `/guides/${g.slug}`),
    '/glossary',
    ...GLOSSARY.map((t) => `/glossary/${t.slug}`)
  ]);
}

function morePages(): string[] {
  const known = described();
  return staticSitemapPages()
    .filter((p) => !known.has(p.path))
    .map((p) => `- ${url(homeLocale(p.locales), p.path)}`);
}

const SUMMARY = `> ${SITE_NAME} is an online invoicing app for freelancers (OSVČ in Czechia, SZČO in Slovakia) and small companies in the Czech Republic and Slovakia. It has a free plan with no time limit, and works in Czech, Slovak and English.`;

const FACTS = [
  'Who it is for: sole traders and small companies invoicing in CZK or EUR, VAT payers and non-payers alike, and their accountants.',
  'Markets: Czech Republic and Slovakia. Customers are looked up in the Czech ARES and Slovak RPO registers and checked in EU VIES.',
  'Invoices carry a QR payment code: QR Platba (SPAYD) for Czech accounts, PAY by square for Slovak IBANs.',
  'Documents: invoices, proforma invoices, credit notes and quotes, in Czech, Slovak or English, in foreign currencies with central-bank rates.',
  'Exports: ISDOC for Czech accounting software, UBL e-invoices (Peppol BIS 3.0), CSV and exports for Pohoda and Money S3. Sending over the Peppol network for the Slovak e-invoicing mandate from 2027 is in progress.',
  'Drafts are checked for the details Czech and Slovak VAT and commercial law require before sending.',
  'AI: an invoice can be drafted from a voice or text message (Telegram, WhatsApp) and receipts read from a photo. Plans include AI credits, or you can use your own AI key without limits.',
  'Payments: bank payment matching, Fio bank sync, PayPal sync, reminders, partial payments, a client portal and card payments on invoices (Plus and up).',
  'Tax: VAT threshold tracking, a tax calendar, income tax figures, and on Plus the VAT return, control statement and EC sales list (EPO in Czechia, eDane in Slovakia).',
  `Accountants: from the Start plan, one accountant gets access to a client's company free of charge.`,
  `Guest invoice: ${url(routing.defaultLocale, '/create-invoice')} creates a PDF invoice with no sign-up and stores nothing.`
].map((f) => `- ${f}`);

/** The short map: facts, prices, and links to every public page. */
export function buildLlmsTxt(): string {
  const l = routing.defaultLocale;
  return [
    `# ${SITE_NAME}`,
    '',
    SUMMARY,
    '',
    ...FACTS,
    '',
    `## Pricing`,
    '',
    ...pricingLines(),
    '',
    '## Main pages',
    '',
    ...MAIN_PAGES.map(([path, label]) => `- [${label.split(':')[0]}](${url(l, path)}):${label.split(':').slice(1).join(':')}`),
    '',
    '## Features',
    '',
    ...featureLines('en', false),
    '',
    '## Free tools and guides',
    '',
    ...toolLines(),
    '',
    '## Comparisons',
    '',
    ...compareLines(),
    ...section('More pages', morePages()),
    '',
    '## Languages',
    '',
    ...routing.locales.map((loc) => `- ${LANGUAGE_NAMES[loc] ?? loc}: ${url(loc, '/')}`),
    '',
    `## Optional`,
    '',
    `- [Full version](${SITE_URL}/llms-full.txt): feature details, the plan comparison table and FAQs in Czech, Slovak and English`,
    ''
  ].join('\n');
}

function section(title: string, lines: string[]): string[] {
  return lines.length ? ['', `## ${title}`, '', ...lines] : [];
}

function comparisonTable(): string[] {
  const c = en.pricing.compare;
  const rows = c.rows as Record<string, string>;
  const cells = c.cell as Record<string, string>;
  const groups = c.groups as Record<string, string>;
  const names = PLANS.map((p) => (en.pricing.plans as Record<string, { name: string }>)[p.key]!.name);
  const payg = `${price('CZK', PAYG_PRICE.CZK)} / ${price('EUR', PAYG_PRICE.EUR)}`;
  const cell = (v: boolean | number | string) => (v === true ? 'yes' : v === false ? '–' : typeof v === 'number' ? v.toLocaleString('en') : fill(cells[v] ?? v, { payg }));
  return [
    `| Feature | ${names.join(' | ')} |`,
    `|---|${names.map(() => '---').join('|')}|`,
    ...COMPARISON.flatMap((g) => [
      `| **${groups[g.group] ?? g.group}** |${names.map(() => ' ').join('|')}|`,
      ...g.rows.map(([row, values]) => `| ${rows[row] ?? row} | ${values.map(cell).join(' | ')} |`)
    ])
  ];
}

function faqs(locale: string): string[] {
  const m = MESSAGES[locale]!;
  const currency: PlanCurrency = locale === 'cs' ? 'CZK' : 'EUR';
  const cheapest = Math.min(...PLANS.filter((p) => p.price[currency].yearly > 0).map((p) => p.price[currency].yearly));
  const params = {
    price: formatPlanPrice(cheapest, currency, locale),
    payg: formatPlanPrice(PAYG_PRICE[currency], currency, locale),
    percent: BANK_TRANSFER_SURCHARGE_PERCENT,
    welcome: REFERRAL_REWARDS.accountant.welcome,
    reward: REFERRAL_REWARDS.accountant.reward
  };
  const groups: [path: string, faq: Faq][] = [
    ['/', Object.values(m.marketing.faq.items as Record<string, { q: string; a: string }>)],
    ['/pricing', m.pricing.faq.items as Faq],
    ['/create-invoice', m.guestInvoice.faq.items as Faq],
    ['/for-accountants', m.accountants.faq as Faq]
  ];
  return groups.flatMap(([path, faq]) => [
    '',
    `### ${url(locale, path)}`,
    '',
    ...faq.flatMap(({ q, a }) => [`Q: ${q}`, `A: ${fill(a, params)}`, ''])
  ]);
}

/** The long version: everything in llms.txt plus feature details, the plan table and the FAQs in every language. */
export function buildLlmsFullTxt(): string {
  return [
    buildLlmsTxt().replace(/\n## Optional\n[\s\S]*$/, ''),
    '## Plan comparison',
    '',
    ...comparisonTable(),
    '',
    '## Feature details',
    '',
    ...featureLines('en', true),
    '',
    ...routing.locales.flatMap((loc) => [`## FAQ in ${LANGUAGE_NAMES[loc] ?? loc}`, ...faqs(loc)]),
    ''
  ].join('\n');
}
