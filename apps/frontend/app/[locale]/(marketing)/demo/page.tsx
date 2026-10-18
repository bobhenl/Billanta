import type { Metadata } from 'next';
import { Check, Eye, Calculator, UserCog } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoKindPicker } from '@/components/demo/demo-kind-picker';
import { Link, redirect } from '@/i18n/navigation';
import { DEMO_VIEW_ROLES, demoEnabled } from '@/lib/demo';
import { demoAudience } from '@/lib/demo-audiences';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

type Faq = { q: string; a: string };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'demo' });
  // `?view=` and `?for=` only preselect the picker; every variant shares this one canonical page.
  return publicPageMetadata({ locale, path: '/demo', title: t('meta.title'), description: t('meta.description') });
}

// The marketing pages around it are static, so the switch is read per request here.
export const dynamic = 'force-dynamic';

const ROLE_ICONS = { owner: UserCog, accountant: Calculator, viewer: Eye } as const;

/** What to look at in the demo, each pointing to its feature page. */
const TRY = [
  ['invoices', '/features/qr-payments'],
  ['payments', '/features/partial-payments'],
  ['reminders', '/features/payment-reminders'],
  ['expenses', '/features/expense-tracking'],
  ['vat', '/features/vat-returns-epo'],
  ['accountant', '/features/accountant-export'],
  ['team', '/features/team-and-roles'],
  ['quotes', '/features/quotes-and-proforma-invoices']
] as const;

/** The demo playground's entry (docs/demo-playground-plan.md): pick a kind of company and a view, land in its dashboard. */
export default async function DemoPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string | string[]; for?: string | string[] }>;
}) {
  const { locale } = await params;
  // The links to this page are baked into static pages; with the demo off they still lead somewhere useful.
  if (!demoEnabled()) redirect({ href: '/signup', locale });
  setRequestLocale(locale);
  const { view, for: audienceParam } = await searchParams;
  const initialView = DEMO_VIEW_ROLES.find((r) => r === view) ?? 'owner';
  const audience = demoAudience(audienceParam);
  const t = await getTranslations('demo');
  const title = t('page.title', { site: SITE_NAME });
  const faq = t.raw('page.faq') as Faq[];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
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
      <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <p className="mt-3 text-base text-muted-foreground md:text-lg">{t('page.lead')}</p>
      <ul className="mt-6 space-y-2 text-sm">
        {(['time', 'safe', 'empty', 'keep'] as const).map((key) => (
          <li key={key} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t(`page.points.${key}`)}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-base font-semibold">{t('page.pick')}</h2>
      {audience && <p className="mt-1 text-sm text-muted-foreground">{t(`audiences.${audience}`)}</p>}
      <DemoKindPicker locale={locale} initialView={initialView} audience={audience} />

      <h2 className="mt-14 text-xl font-semibold tracking-tight">{t('page.rolesTitle')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('page.rolesLead')}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {DEMO_VIEW_ROLES.map((r) => {
          const Icon = ROLE_ICONS[r];
          return (
            <div key={r} className="rounded-xl border border-border bg-card p-4">
              <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="mt-2 font-semibold">{t(`roles.${r}.label`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`roles.${r}.hint`)}</p>
            </div>
          );
        })}
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight">{t('page.tryTitle')}</h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {TRY.map(([key, href]) => (
          <li key={key}>
            <Link href={href} className="flex gap-2 rounded-lg border border-border bg-card p-3 text-sm hover:border-primary/40">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="font-semibold">{t(`page.try.${key}.title`)}</span>
                <span className="block text-muted-foreground">{t(`page.try.${key}.text`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <Link href="/features" className="font-medium text-primary hover:underline">
          {t('page.allFeatures')} →
        </Link>
      </p>

      <div className="mt-14 border-t border-border pt-8">
        <h2 className="text-xl font-semibold">{t('page.faqTitle')}</h2>
        <dl className="mt-4 divide-y divide-border">
          {faq.map(({ q, a }) => (
            <div key={q} className="py-4">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
