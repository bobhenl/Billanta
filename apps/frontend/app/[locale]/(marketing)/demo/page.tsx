import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoKindPicker } from '@/components/demo/demo-kind-picker';
import { redirect } from '@/i18n/navigation';
import { demoEnabled } from '@/lib/demo';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'demo' });
  return publicPageMetadata({ locale, path: '/demo', title: t('meta.title'), description: t('meta.description') });
}

// The marketing pages around it are static, so the switch is read per request here.
export const dynamic = 'force-dynamic';

/** The demo playground's entry (docs/demo-playground-plan.md): pick a kind of company, land in its dashboard. */
export default async function DemoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // The links to this page are baked into static pages; with the demo off they still lead somewhere useful.
  if (!demoEnabled()) redirect({ href: '/signup', locale });
  setRequestLocale(locale);
  const t = await getTranslations('demo');
  const title = t('page.title', { site: SITE_NAME });

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, '/demo', 'WebPage', title, t('page.lead')),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('cta'), '/demo']
          ])
        ])}
      />
      <p className="text-sm font-semibold text-primary">{t('page.eyebrow')}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <p className="mt-3 text-base text-muted-foreground md:text-lg">{t('page.lead')}</p>
      <ul className="mt-6 space-y-2 text-sm">
        {(['time', 'safe', 'keep'] as const).map((key) => (
          <li key={key} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t(`page.points.${key}`)}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-base font-semibold">{t('page.pick')}</h2>
      <DemoKindPicker locale={locale} />
    </div>
  );
}
