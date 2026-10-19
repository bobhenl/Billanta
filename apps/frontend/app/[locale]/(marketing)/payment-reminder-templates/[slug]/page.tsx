import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { GuideSection } from '@/components/public-tools/guide-page';
import { LawLink } from '@/components/public-tools/invoice-template';
import { CzOnlyNotice, RelatedTools, ToolHeader } from '@/components/public-tools/parts';
import { AutoRemindersBox, ReminderTabs, reminderMetadata } from '@/components/public-tools/payment-reminder';
import { ReminderGenerator } from '@/components/public-tools/reminder-generator';
import { getReminder, isPublishedIn, REMINDERS } from '@/lib/public-tools';
import { breadcrumbLd, jsonLd, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

/**
 * One payment reminder letter: when to send it, what belongs in it linked
 * to the law, the pitfalls, and the generator preset for this letter (it
 * gives the text to copy or a PDF). The pre-action notice is Czech only;
 * its sk URL shows the "Czech rules" notice pointing to the Slovak payment
 * demand.
 */
type Params = { locale: string; slug: string };
type Field = { name: string; text: string; rule?: string };

export const dynamicParams = false;

export function generateStaticParams() {
  return REMINDERS.map((x) => ({ slug: x.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!getReminder(slug)) return {};
  return reminderMetadata(slug, locale);
}

export default async function PaymentReminderPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const x = getReminder(slug);
  if (!x) notFound();

  const t = await getTranslations('paymentReminders');
  const k = `items.${x.key}` as const;
  const path = `/payment-reminder-templates/${slug}`;
  if (!isPublishedIn(x, locale)) {
    return <CzOnlyNotice name={t(`${k}.name`)} path={path} skAlternative={{ href: '/payment-reminder-templates/payment-demand', name: t('items.demand.name') }} />;
  }

  const when = t.raw(`${k}.when`) as string[];
  const fields = t.raw(`${k}.fields`) as Field[];
  const pitfalls = t.raw(`${k}.pitfalls`) as string[];
  const letters = REMINDERS.filter((r) => isPublishedIn(r, locale));
  const others = letters.filter((r) => r.slug !== slug);
  const pill = 'inline-flex rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary';

  return (
    <article className="container py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, path, 'WebPage', t(`${k}.title`), t(`${k}.description`)),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('indexName'), '/payment-reminder-templates'],
            [t(`${k}.name`), path]
          ])
        ])}
      />
      <ReminderTabs current={slug} />
      <ToolHeader hubHref="/payment-reminder-templates" hubLabel={t('indexName')} name={t(`${k}.name`)} title={t(`${k}.title`)} lead={t(`${k}.lead`)} icon={x.icon} />

      <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 lg:order-2">
          <ReminderGenerator kinds={letters.map((r) => r.key)} initialKind={x.key} />
        </div>

        <div className="min-w-0 space-y-10 lg:order-1">
          <GuideSection title={t('common.whenTitle')}>
            {when.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </GuideSection>
          <GuideSection title={t('common.fieldsTitle')}>
            <p className="text-muted-foreground">{t('common.fieldsLead')}</p>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {fields.map((f) => (
                <li key={f.name} className="p-4">
                  <p className="font-semibold">{f.name}</p>
                  <p className="mt-1 text-muted-foreground">{f.text}</p>
                  {f.rule && (
                    <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {f.rule.split(',').map((rule) => (
                        <LawLink key={rule} rule={rule.trim()} />
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </GuideSection>
          <GuideSection title={t('common.pitfallsTitle')}>
            <ul className="list-disc space-y-1.5 pl-5">
              {pitfalls.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </GuideSection>
          <p className="text-xs text-muted-foreground">{t('common.rulesNote')}</p>
        </div>
      </div>

      <div className="mt-12">
        <AutoRemindersBox />
      </div>

      <nav aria-label={t('common.otherTitle')} className="mt-12 border-t border-border pt-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.otherTitle')}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {others.map((r) => (
            <li key={r.slug}>
              <Link href={`/payment-reminder-templates/${r.slug}`} className={pill}>
                {t(`items.${r.key}.name`)}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/invoice-templates" className={pill}>
              {t('common.invoiceTemplates')}
            </Link>
          </li>
          <li>
            <Link href="/payment-reminder-templates" className="inline-flex px-4 py-2 text-sm font-medium text-primary hover:underline">
              {t('common.allTemplates')} →
            </Link>
          </li>
        </ul>
      </nav>
      <div className="mt-12">
        <RelatedTools current={slug} />
      </div>
    </article>
  );
}
