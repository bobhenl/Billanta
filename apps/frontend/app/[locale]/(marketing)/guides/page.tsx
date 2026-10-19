import type { Metadata } from 'next';
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
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(itemList)} />
      <ToolTabs kind="guides" />
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t('guides.indexTitle')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('guides.indexLead')}</p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {guides.map((g) => {
          const Icon = g.icon;
          return (
            <li key={g.slug}>
              <Link href={`/guides/${g.slug}`} className="group flex h-full gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold group-hover:text-primary">{t(`guides.items.${g.key}.name`)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(`guides.items.${g.key}.description`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
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
