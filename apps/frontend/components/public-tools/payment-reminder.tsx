import type { Metadata } from 'next';
import { ArrowRight, BellRing } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ToolTabsStrip } from '@/components/public-tools/tool-tabs-strip';
import { getReminder, isPublishedIn, REMINDERS } from '@/lib/public-tools';
import { toolPageMetadata } from '@/lib/public-tool-meta';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/**
 * Pieces of the public payment reminder templates
 * (`/payment-reminder-templates/<slug>`): metadata, the tab row and the
 * "Billanta sends reminders for you" box. Texts live in `paymentReminders`;
 * the generator's own strings in `reminderGenerator`.
 */

export function reminderMetadata(slug: string, locale: string): Promise<Metadata> {
  const x = getReminder(slug)!;
  return toolPageMetadata({
    locale,
    path: `/payment-reminder-templates/${slug}`,
    tool: x,
    titleKey: `paymentReminders.items.${x.key}.title`,
    descriptionKey: `paymentReminders.items.${x.key}.description`
  });
}

/** Row of the reminder templates published in this language; scrolls sideways inside its own box on a phone. */
export async function ReminderTabs({ current }: { current?: string }) {
  const t = await getTranslations('paymentReminders');
  const locale = await getLocale();
  const tabs = [
    { href: '/payment-reminder-templates', label: t('indexName'), active: !current },
    ...REMINDERS.filter((x) => isPublishedIn(x, locale)).map((x) => ({
      href: `/payment-reminder-templates/${x.slug}`,
      label: t(`items.${x.key}.name`),
      active: x.slug === current
    }))
  ];
  return (
    <ToolTabsStrip storageKey="payment-reminders" label={t('indexName')} className="mb-8 max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
      <ul className="flex w-max gap-1 rounded-xl border border-border bg-card p-1">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                'block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                tab.active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </ToolTabsStrip>
  );
}

/** Billanta's automatic reminders: the step after writing the letters by hand. */
export async function AutoRemindersBox() {
  const t = await getTranslations('paymentReminders.auto');
  return (
    <aside className="flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-start sm:p-6">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <BellRing className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('text')}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/signup" className={cn(buttonClass.primary, 'inline-flex items-center gap-2')}>
            {t('cta')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href="/features/payment-reminders" className={buttonClass.secondary}>
            {t('more')}
          </Link>
        </div>
      </div>
    </aside>
  );
}

/** Link from the invoice templates to the reminders ("invoice overdue?"). */
export async function RemindersLink() {
  const t = await getTranslations('paymentReminders.fromInvoices');
  return (
    <Link
      href="/payment-reminder-templates"
      className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <BellRing className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold group-hover:text-primary">{t('title')}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{t('text')}</span>
      </span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
    </Link>
  );
}
