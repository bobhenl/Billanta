import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SignupCta } from '@/components/public-tools/parts';
import { RemindersLink } from '@/components/public-tools/payment-reminder';
import { TemplateTabs } from '@/components/public-tools/invoice-template';
import { isPublishedIn, TEMPLATES } from '@/lib/public-tools';
import { toolPageMetadata } from '@/lib/public-tool-meta';
import { routing } from '@/i18n/routing';
import { jsonLd } from '@/lib/seo';
import { buttonClass } from '@/lib/ui-classes';
import { SITE_URL } from '@/lib/site';
import { cn } from '@/lib/utils';

/**
 * Hub of the invoice templates ("vzor faktury"). Published in every
 * language: cs and en follow Czech law, sk Slovak law. Like the guides hub
 * it carries an ItemList and no two-rung BreadcrumbList.
 */
type Params = { locale: string };
const HUB = { locales: routing.locales };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return toolPageMetadata({
    locale,
    path: '/invoice-templates',
    tool: HUB,
    titleKey: 'invoiceTemplates.indexTitle',
    descriptionKey: 'invoiceTemplates.indexDescription'
  });
}

export default async function InvoiceTemplatesHub({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('invoiceTemplates');
  const templates = TEMPLATES.filter((x) => isPublishedIn(x, locale));
  const how = t.raw('how') as string[];

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('indexName'),
    itemListElement: templates.map((x, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t(`items.${x.key}.title`),
      url: `${SITE_URL}/${locale}/invoice-templates/${x.slug}`
    }))
  };

  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(itemList)} />
      <TemplateTabs />
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t('indexTitle')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('indexLead')}</p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((x) => {
          const Icon = x.icon;
          return (
            <li key={x.slug}>
              <Link
                href={`/invoice-templates/${x.slug}`}
                className="group flex h-full gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold group-hover:text-primary">{t(`items.${x.key}.name`)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(`items.${x.key}.lead`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-12 max-w-3xl">
        <h2 className="text-xl font-semibold">{t('howTitle')}</h2>
        <ol className="mt-4 space-y-3">
          {how.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <Link href="/create-invoice" className={cn(buttonClass.primary, 'mt-6 inline-flex items-center gap-2')}>
          {t('common.useButton')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <p className="mt-6 text-xs text-muted-foreground">{t('common.rulesNote')}</p>
      </div>

      <div className="mt-12">
        <RemindersLink />
      </div>
      <div className="mt-12">
        <SignupCta />
      </div>
    </section>
  );
}
