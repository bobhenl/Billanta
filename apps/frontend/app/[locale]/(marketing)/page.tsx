import type { ComponentType } from 'react';
import type { Metadata } from 'next';
import {
  ArrowRight,
  BellRing,
  Check,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Files,
  Globe,
  Mic,
  QrCode,
  Receipt,
  RefreshCw,
  Repeat,
  Send,
  ShieldCheck,
  Sparkles,
  Timer
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { HintCard } from '@/components/hint-card';
import { MarketingInvoiceMockup } from '@/components/marketing-invoice-mockup';
import { BRANDS } from '@/lib/competitors';
import { jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Public homepage — the main SEO entry point. Kept deliberately compact:
 * each feature and step is a one-line title, with its explanation behind
 * an (i) hint (still in the DOM, so still indexed). The FAQ is the one
 * place where answers are long-form, and it is mirrored 1:1 in FAQPage
 * structured data — structured data must describe text the visitor can
 * actually see, so both come from the same message keys.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
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
  | 'time';
type StepKey = 'capture' | 'draft' | 'issue' | 'getPaid';

const FEATURES: { key: FeatureKey; icon: Icon }[] = [
  { key: 'aiVoice', icon: Mic },
  { key: 'isdoc', icon: FileText },
  { key: 'compliance', icon: ShieldCheck },
  { key: 'qr', icon: QrCode },
  { key: 'multilang', icon: Globe },
  { key: 'bankSync', icon: RefreshCw },
  { key: 'reminders', icon: BellRing },
  { key: 'vat', icon: FileSpreadsheet },
  { key: 'expenses', icon: Receipt },
  { key: 'recurring', icon: Repeat },
  { key: 'templates', icon: Files },
  { key: 'time', icon: Timer }
];

const STEPS: { key: StepKey; icon: Icon }[] = [
  { key: 'capture', icon: Mic },
  { key: 'draft', icon: Sparkles },
  { key: 'issue', icon: FileCheck2 },
  { key: 'getPaid', icon: Send }
];

const FAQ_KEYS = ['free', 'isdoc', 'ares', 'voice', 'data'] as const;
const HERO_POINTS = ['isdoc', 'ares', 'qr'] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('marketing');
  const tApp = await getTranslations('app');
  const tFeatures = await getTranslations('featurePages');
  const tCompare = await getTranslations('comparePage');

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`
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
        acceptedAnswer: { '@type': 'Answer', text: t(`faq.items.${key}.a`) }
      }))
    }
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />

      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[56rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="container relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-14 lg:py-20">
          <div className="flex flex-col items-start gap-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              {t('hero.eyebrow')}
            </span>
            <h1 className="max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl lg:leading-[1.08]">
              {t('hero.title')}
            </h1>
            <p className="max-w-xl text-base text-muted-foreground sm:text-lg">{t('hero.subtitle')}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm font-medium">
              {HERO_POINTS.map((key) => (
                <li key={key} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t(`hero.points.${key}`)}
                </li>
              ))}
            </ul>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
              >
                {t('hero.cta')}
              </Link>
              <Link
                href="/vytvorit-fakturu"
                className="inline-flex items-center justify-center rounded-full border border-border px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {t('hero.guestCta')}
              </Link>
              <a
                href="#how"
                className="inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:text-primary"
              >
                {t('hero.secondaryCta')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="mx-auto w-full max-w-md lg:mx-0">
            <MarketingInvoiceMockup />
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-16 border-b border-border py-12 sm:py-16">
        <div className="container">
          <SectionHeading title={t('features.title')} />
          <ul className="mt-8 grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ key, icon: FeatureIcon }) => (
              <HintCard
                key={key}
                leading={
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <FeatureIcon className="h-4 w-4" />
                  </span>
                }
                title={t(`features.${key}.title`)}
                hint={t(`features.${key}.description`)}
              />
            ))}
          </ul>
          <Link href="/funkce" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            {tFeatures('allFeatures')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section id="how" className="scroll-mt-16 border-b border-border bg-card/40 py-12 sm:py-16">
        <div className="container">
          <SectionHeading title={t('howItWorks.title')} />
          <ol className="mt-8 grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ key, icon: StepIcon }, index) => (
              <HintCard
                key={key}
                className="bg-background"
                leading={
                  <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                      {index + 1}
                    </span>
                    <StepIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                }
                title={t(`howItWorks.steps.${key}.title`)}
                hint={t(`howItWorks.steps.${key}.description`)}
              />
            ))}
          </ol>
        </div>
      </section>

      {/* A taste of /srovnani: the three rows people ask about first. */}
      <section id="compare" className="scroll-mt-16 border-b border-border py-12 sm:py-16">
        <div className="container">
          <SectionHeading title={t('compare.title')} lead={t('compare.lead')} />
          <div className="mt-8 space-y-3 sm:hidden">
            {TEASER_ROWS.map((row) => (
              <div key={row} className="rounded-xl border border-border bg-card p-3">
                <h3 className="text-sm font-bold">{tCompare(`rows.${row}.label`)}</h3>
                <dl className="mt-2 space-y-1 text-[13px]">
                  {TEASER_BRANDS.map((b) => (
                    <div key={b.key} className={`flex justify-between gap-3 rounded px-1.5 py-0.5 ${b.key === 'billanta' ? 'bg-primary/5' : ''}`}>
                      <dt className={b.key === 'billanta' ? 'font-bold text-primary' : 'text-muted-foreground'}>{b.name}</dt>
                      <dd className={`text-right ${b.key === 'billanta' ? 'font-medium' : 'text-muted-foreground'}`}>{tCompare(`rows.${row}.${b.key}`)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <div className="mt-8 hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="w-36 px-3 py-2.5 text-left font-semibold text-muted-foreground">
                    <span className="sr-only">{tCompare('feature')}</span>
                  </th>
                  {TEASER_BRANDS.map((b) => (
                    <th key={b.key} scope="col" className={`px-3 py-2.5 text-left font-bold ${b.key === 'billanta' ? 'bg-primary/5 text-primary' : ''}`}>
                      {b.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TEASER_ROWS.map((row) => (
                  <tr key={row} className="border-b border-border last:border-0">
                    <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                      {tCompare(`rows.${row}.label`)}
                    </th>
                    {TEASER_BRANDS.map((b) => (
                      <td key={b.key} className={`px-3 py-2.5 ${b.key === 'billanta' ? 'bg-primary/5 font-medium' : 'text-muted-foreground'}`}>
                        {b.key === 'billanta' && <Check className="mr-1 inline h-4 w-4 align-[-3px] text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                        {tCompare(`rows.${row}.${b.key}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link href="/srovnani" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
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
                <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{t(`faq.items.${key}.a`)}</p>
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

const TEASER_ROWS = ['free', 'entry', 'ai'] as const;
const TEASER_BRANDS = BRANDS.filter((b) => ['billanta', 'fakturoid', 'idoklad', 'superfaktura'].includes(b.key));

function SectionHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
      {lead && <p className="mt-2 text-sm text-muted-foreground sm:text-base">{lead}</p>}
    </div>
  );
}
