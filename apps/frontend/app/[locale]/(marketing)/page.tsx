import type { ComponentType } from 'react';
import type { Metadata } from 'next';
import {
  ArrowRight,
  BellRing,
  Check,
  FileSpreadsheet,
  Mic,
  QrCode,
  RefreshCw,
  Wallet
} from 'lucide-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { MarketingHeroSlides } from '@/components/marketing-hero-slides';
import { TEASER_ROW_KEYS, brandsFor, comparedAtLabel, rowsFor } from '@/lib/competitors';
import { defaultCurrency, formatPlanPrice, startingPrice } from '@/lib/plans';
import { jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Public homepage – the main SEO entry point. Kept deliberately compact:
 * hero, six features, a comparison teaser, FAQ and one closing CTA, each
 * section making one point. The FAQ is the one place where answers are
 * long-form, and it is mirrored 1:1 in FAQPage structured data: structured
 * data must describe text the visitor can actually see, so both come from
 * the same message keys.
 */
/**
 * A one-segment path with a dot (`/favicon.ico`, `/sitemap.xml`,
 * `/wp-login.php`) skips the middleware and lands here as the "locale".
 * The layout's notFound() alone does not stop this page from rendering, and
 * Intl throws on such a locale, so every bot probe was a full render ending
 * in a 500. Checked first, in the metadata too, it is a cheap 404.
 */
function rejectUnknownLocale(locale: string) {
  if (!hasLocale(routing.locales, locale)) notFound();
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  rejectUnknownLocale(locale);
  const t = await getTranslations({ locale, namespace: 'marketing' });
  // The layout's title template would append the brand again; the
  // homepage title already leads with it.
  return publicPageMetadata({ locale, path: '/', title: { absolute: t('seo.title') }, description: t('seo.description') });
}

type Icon = ComponentType<{ className?: string }>;
type FeatureKey =
  | 'aiVoice'
  | 'isdoc'
  | 'compliance'
  | 'qr'
  | 'multilang'
  | 'bankSync'
  | 'reminders'
  | 'vat'
  | 'expenses'
  | 'recurring'
  | 'templates'
  | 'time'
  | 'taxEstimate'
  | 'currencies'
  | 'clientPortal'
  | 'migration'
  | 'api'
  | 'team'
  | 'auditLog'
  | 'reports'
  | 'backups';

// Every entry is a feature the app has today (checked against the code,
// not the roadmap); the wording lives in `marketing.features.<key>`.
const FEATURES: { key: FeatureKey; icon: Icon }[] = [
  { key: 'aiVoice', icon: Mic },
  { key: 'qr', icon: QrCode },
  { key: 'bankSync', icon: RefreshCw },
  { key: 'reminders', icon: BellRing },
  { key: 'vat', icon: FileSpreadsheet },
  { key: 'taxEstimate', icon: Wallet }
];

// No separate "how it works" steps: the hero slides already tell the
// dictate → send → paid story, and the steps only repeated the features.

const FAQ_KEYS = ['free', 'slovakia', 'isdoc', 'ares', 'voice', 'data'] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  rejectUnknownLocale(locale);
  setRequestLocale(locale);
  const t = await getTranslations('marketing');
  const tApp = await getTranslations('app');
  const tFeatures = await getTranslations('featurePages');
  const tCompare = await getTranslations('comparePage');
  const tDemo = await getTranslations('demo');
  const BRANDS = brandsFor(locale).slice(0, 4);
  // The "how much" answer quotes the price list, so a price change can't leave it stale.
  const currency = defaultCurrency(locale);
  const faqParams = { price: formatPlanPrice(startingPrice(currency), currency, locale) };
  const TEASER_ROWS = rowsFor(locale).filter((r) => (TEASER_ROW_KEYS as readonly string[]).includes(r.key));

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/brand/logo.png`
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: `${SITE_URL}/${locale}`,
      inLanguage: locale
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: t('seo.description'),
      url: `${SITE_URL}/${locale}`,
      inLanguage: ['cs', 'sk', 'en'],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'CZK' }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: locale,
      mainEntity: FAQ_KEYS.map((key) => ({
        '@type': 'Question',
        name: t(`faq.items.${key}.q`),
        acceptedAnswer: { '@type': 'Answer', text: t(`faq.items.${key}.a`, faqParams) }
      }))
    }
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />

      <section className="border-b border-border">
        <div className="container grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-14 lg:py-20">
          <div className="flex flex-col items-start gap-5">
            <h1 className="max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl lg:leading-[1.08]">
              {t('hero.title')}
            </h1>
            <p className="max-w-xl text-base text-muted-foreground sm:text-lg">{t('hero.subtitle')}</p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
              >
                {t('hero.cta')}
              </Link>
              <Link
                href="/demo"
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {tDemo('cta')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <p className="-mt-1 text-sm text-muted-foreground">
              {t.rich('hero.note', {
                write: (chunks) => (
                  <Link href="/create-invoice" className="font-semibold text-primary hover:underline">
                    {chunks}
                  </Link>
                ),
                voice: (chunks) => (
                  <Link href="/dictate-invoice" className="font-semibold text-primary hover:underline">
                    {chunks}
                  </Link>
                )
              })}
            </p>
          </div>

          <div className="mx-auto w-full max-w-md lg:mx-0">
            <MarketingHeroSlides />
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-16 border-b border-border py-12 sm:py-16">
        <div className="container">
          <SectionHeading title={t('features.title')} />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ key, icon: FeatureIcon }) => (
              <li key={key} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FeatureIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-bold leading-snug">{t(`features.${key}.title`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`features.${key}.description`)}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link href="/features" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            {tFeatures('allFeatures')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* A taste of /compare: the rows people ask about first, from the same data and wording as the full table. */}
      <section id="compare" className="scroll-mt-16 border-b border-border py-12 sm:py-16">
        <div className="container">
          <SectionHeading title={t('compare.title')} lead={t('compare.lead')} />
          <div className="mt-8 space-y-3 sm:hidden">
            {TEASER_ROWS.map(({ key: row, good }) => (
              <div key={row} className="rounded-xl border border-border bg-card p-3">
                <h3 className="text-sm font-bold">{tCompare(`rows.${row}.label`)}</h3>
                <dl className="mt-2 space-y-1 text-[13px]">
                  {BRANDS.map((b) => (
                    <div key={b.key} className={`flex justify-between gap-3 rounded px-1.5 py-0.5 ${b.key === 'billanta' ? 'bg-primary/5' : ''}`}>
                      <dt className={b.key === 'billanta' ? 'font-bold text-primary' : 'text-muted-foreground'}>{b.name}</dt>
                      <dd className={`flex items-center gap-1 text-right ${good.includes(b.key) ? 'font-medium' : 'text-muted-foreground'}`}>
                        {good.includes(b.key) && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                        {tCompare(`rows.${row}.${b.key}`)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <div className="mt-8 hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="w-36 px-3 py-2.5 text-left font-semibold text-muted-foreground">
                    <span className="sr-only">{tCompare('feature')}</span>
                  </th>
                  {BRANDS.map((b) => (
                    <th key={b.key} scope="col" className={`px-3 py-2.5 text-left font-bold ${b.key === 'billanta' ? 'bg-primary/5 text-primary' : ''}`}>
                      {b.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TEASER_ROWS.map(({ key: row, good }) => (
                  <tr key={row} className="border-b border-border align-top last:border-0">
                    <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                      {tCompare(`rows.${row}.label`)}
                    </th>
                    {BRANDS.map((b) => (
                      <td
                        key={b.key}
                        className={`px-3 py-2.5 ${b.key === 'billanta' ? 'bg-primary/5' : ''} ${good.includes(b.key) ? 'font-medium' : 'text-muted-foreground'}`}
                      >
                        {good.includes(b.key) && <Check className="mr-1 inline h-4 w-4 align-[-3px] text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                        {tCompare(`rows.${row}.${b.key}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{tCompare('verified', { date: comparedAtLabel(locale) })}</span>. {tCompare('notStated')}.
          </p>
          <Link href="/compare" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            {t('compare.more')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section id="faq" className="scroll-mt-16 border-b border-border py-12 sm:py-16">
        <div className="container max-w-3xl">
          <SectionHeading title={t('faq.title')} />
          <div className="mt-8 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {FAQ_KEYS.map((key) => (
              <details key={key} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <h3>{t(`faq.items.${key}.q`)}</h3>
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{t(`faq.items.${key}.a`, faqParams)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="container">
          <div className="flex flex-col items-start gap-4 rounded-2xl bg-primary p-6 text-primary-foreground sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{t('finalCta.title')}</h2>
              <p className="mt-1 text-sm opacity-85">{t('finalCta.subtitle')}</p>
            </div>
            <Link
              href="/signup"
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary-foreground px-6 py-3 text-sm font-bold text-primary transition-opacity hover:opacity-90"
            >
              {t('finalCta.cta', { name: tApp('name') })}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
      {lead && <p className="mt-2 text-sm text-muted-foreground sm:text-base">{lead}</p>}
    </div>
  );
}
