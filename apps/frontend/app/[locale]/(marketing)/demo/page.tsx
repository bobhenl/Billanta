import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoKindPicker, type DemoPresetLabels } from '@/components/demo/demo-kind-picker';
import { BUSINESS_PRESETS } from '@/lib/business-presets';
import { Link, redirect } from '@/i18n/navigation';
import { DEMO_VIEW_ROLES, demoEnabled, type DemoViewRole } from '@/lib/demo';
import { demoAudience } from '@/lib/demo-audiences';
import { DEMO_SCENARIOS, demoScenario, type DemoScenario } from '@/lib/demo-scenarios';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

type Faq = { q: string; a: string };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'demo' });
  // `?view=`, `?for=` and `?scenario=` only preselect the picker; every variant shares this one canonical page.
  return publicPageMetadata({ locale, path: '/demo', title: t('meta.title'), description: t('meta.description') });
}

// The marketing pages around it are static, so the switch is read per request here.
export const dynamic = 'force-dynamic';

/** The demo playground's entry (docs/demo-playground-plan.md): pick a kind of company and a view, land in its dashboard. */
export default async function DemoPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string | string[]; for?: string | string[]; scenario?: string | string[] }>;
}) {
  const { locale } = await params;
  // The links to this page are baked into static pages; with the demo off they still lead somewhere useful.
  if (!demoEnabled()) redirect({ href: '/signup', locale });
  setRequestLocale(locale);
  const { view, for: audienceParam, scenario: scenarioParam } = await searchParams;
  // A lesson's scenario is more specific than an audience, so it wins when a link carries both.
  const scenario = demoScenario(scenarioParam);
  const scenarioView: DemoViewRole | undefined = scenario ? (DEMO_SCENARIOS[scenario] as DemoScenario).view : undefined;
  const initialView = DEMO_VIEW_ROLES.find((r) => r === view) ?? scenarioView ?? 'owner';
  const audience = scenario ? null : demoAudience(audienceParam);
  const t = await getTranslations('demo');
  const title = t('page.title', { site: SITE_NAME });
  const faq = t.raw('page.faq') as Faq[];
  const tm = await getTranslations('settings.modules');
  const presets: DemoPresetLabels = Object.fromEntries(
    BUSINESS_PRESETS.map((p) => [p.key, { title: tm(`presets.${p.key}.title`), description: tm(`presets.${p.key}.description`) }])
  );

  return (
    <div className="container max-w-3xl py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, '/demo', 'WebPage', title, t('page.lead')),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('cta'), '/demo']
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: `${SITE_NAME} – ${t('cta')}`,
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            browserRequirements: 'Requires JavaScript',
            url: `${SITE_URL}/${locale}/demo`,
            description: t('meta.description'),
            inLanguage: locale,
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: '0', priceCurrency: locale === 'sk' ? 'EUR' : 'CZK' }
          },
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
          }
        ])}
      />
      <p className="text-sm font-semibold text-primary">{t('page.eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground sm:text-lg">{t('page.lead')}</p>
      <ul className="mt-6 space-y-2 text-sm">
        {(['time', 'safe', 'empty'] as const).map((key) => (
          <li key={key} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t(`page.points.${key}`)}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-xl font-bold tracking-tight">{t('page.pick')}</h2>
      {audience && <p className="mt-1 text-sm text-muted-foreground">{t(`audiences.${audience}`)}</p>}
      {scenario && <p className="mt-1 text-sm text-muted-foreground">{t(`scenarios.${scenario}`)}</p>}
      <DemoKindPicker locale={locale} presets={presets} initialView={initialView} audience={audience} scenario={scenario} />

      <p className="mt-10 text-sm">
        <Link href="/features" className="font-medium text-primary hover:underline">
          {t('page.allFeatures')} →
        </Link>
      </p>

      <div className="mt-14 border-t border-border pt-8">
        <h2 className="text-xl font-bold tracking-tight">{t('page.faqTitle')}</h2>
        <dl className="mt-4 divide-y divide-border">
          {faq.map(({ q, a }) => (
            <div key={q} className="py-4">
              <dt className="font-semibold">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
