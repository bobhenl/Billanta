import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AutoRemindersBox, ReminderTabs } from '@/components/public-tools/payment-reminder';
import { ReminderGenerator } from '@/components/public-tools/reminder-generator';
import { isPublishedIn, REMINDERS } from '@/lib/public-tools';
import { toolPageMetadata } from '@/lib/public-tool-meta';
import { routing } from '@/i18n/routing';
import { jsonLd } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';

/**
 * Hub of the payment reminder templates ("vzor upomínky"): the letters, the
 * generator with every letter published in this language, and the pitch
 * for automatic reminders. Like the other hubs it carries an ItemList and
 * no two-rung BreadcrumbList.
 */
type Params = { locale: string };
const HUB = { locales: routing.locales };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return toolPageMetadata({
    locale,
    path: '/payment-reminder-templates',
    tool: HUB,
    titleKey: 'paymentReminders.indexTitle',
    descriptionKey: 'paymentReminders.indexDescription'
  });
}

export default async function PaymentRemindersHub({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('paymentReminders');
  const letters = REMINDERS.filter((x) => isPublishedIn(x, locale));
  const how = t.raw('how') as string[];

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('indexName'),
    itemListElement: letters.map((x, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t(`items.${x.key}.title`),
      url: `${SITE_URL}/${locale}/payment-reminder-templates/${x.slug}`
    }))
  };

  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(itemList)} />
      <ReminderTabs />
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t('indexTitle')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('indexLead')}</p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {letters.map((x, i) => {
          const Icon = x.icon;
          return (
            <li key={x.slug}>
              <Link
                href={`/payment-reminder-templates/${x.slug}`}
                className="group flex h-full gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('step', { n: i + 1 })}</span>
                  <span className="mt-0.5 block font-semibold group-hover:text-primary">{t(`items.${x.key}.name`)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(`items.${x.key}.lead`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="min-w-0">
          <ReminderGenerator kinds={letters.map((x) => x.key)} initialKind="reminder" />
        </div>
        <div className="min-w-0 space-y-6">
          <div>
            <h2 className="text-xl font-semibold">{t('howTitle')}</h2>
            <ol className="mt-4 space-y-3">
              {how.map((step, i) => (
                <li key={step} className="flex gap-3 text-sm leading-relaxed">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">{t('common.rulesNote')}</p>
        </div>
      </div>

      <div className="mt-12">
        <AutoRemindersBox />
      </div>
    </section>
  );
}
