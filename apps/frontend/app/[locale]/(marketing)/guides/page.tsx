import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ToolTabs } from '@/components/public-tools/tool-tabs';
import { NextPages } from '@/components/learn-page';
import { CzOnlyNotice, SignupCta } from '@/components/public-tools/parts';
import { GUIDES, GUIDES_HUB_LOCALES, isPublishedIn } from '@/lib/public-tools';
import { toolPageMetadata } from '@/lib/public-tool-meta';
import { jsonLd } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';

/**
 * Hub of the public guides. Each language lists only the guides published
 * in it, so the sk hub shows the Slovak e-invoicing guide and none of the
 * Czech VAT ones.
 */
type Params = { locale: string };
const HUB = { locales: GUIDES_HUB_LOCALES };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return toolPageMetadata({ locale, path: '/guides', tool: HUB, titleKey: 'tools.guides.indexTitle', descriptionKey: 'tools.guides.indexDescription' });
}

export default async function GuidesHub({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tools');
  const tLearn = await getTranslations('learnPages.common');
  if (!isPublishedIn(HUB, locale)) return <CzOnlyNotice name={t('guides.indexTitle')} path="/guides" />;
  const guides = GUIDES.filter((g) => isPublishedIn(g, locale));

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('guides.indexTitle'),
    itemListElement: guides.map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t(`guides.items.${g.key}.name`),
      url: `${SITE_URL}/${locale}/guides/${g.slug}`
    }))
  };

  return (
    <section className="container py-6 sm:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(itemList)} />
      <ToolTabs kind="guides" />
      <h1 className="max-w-3xl text-2xl font-extrabold tracking-tight sm:text-4xl">{t('guides.indexTitle')}</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground sm:mt-3 sm:text-lg">{t('guides.indexLead')}</p>
      <ul className="mt-6 grid gap-3 sm:mt-8 sm:grid-cols-2">
        {guides.map((g) => (
          <li key={g.slug}>
            <Link href={`/guides/${g.slug}`} className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-colors sm:p-5 hover:border-primary/40">
              <h2 className="flex items-center justify-between gap-2 text-base font-bold">
                {t(`guides.items.${g.key}.name`)}
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(`guides.items.${g.key}.description`)}</p>
            </Link>
          </li>
        ))}
      </ul>
      <NextPages
        title={tLearn('basicsTitle')}
        items={(['first', 'beginners', 'advanced'] as const).map((key) => ({
          href: { first: '/your-first-invoice', beginners: '/invoicing-for-beginners', advanced: '/invoicing-for-advanced' }[key],
          title: tLearn(`pages.${key}.title`),
          body: tLearn(`pages.${key}.body`)
        }))}
      />
      <p className="mt-8 text-sm">
        <Link href="/calculators" className="font-medium text-primary hover:underline">
          {t('common.allCalculators')} →
        </Link>
      </p>
      <div className="mt-12">
        <SignupCta />
      </div>
    </section>
  );
}
