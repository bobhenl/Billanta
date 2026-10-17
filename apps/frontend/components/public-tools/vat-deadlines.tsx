'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { nextVatDeadlines, type VatDeadlines as Deadlines } from '@faktur/cz-compliance';

/**
 * The next monthly and quarterly VAT deadlines (25th, moved to the next
 * Czech working day), from the same nextVatDeadlines() the in-app EPO
 * guide uses. Computed in the browser after mount: the page is static, and
 * a date baked in at build time would go stale.
 */
export function VatDeadlines() {
  const t = useTranslations('tools.guides.items.vatFiling');
  const format = useFormatter();
  const [d, setD] = useState<Deadlines | null>(null);
  useEffect(() => setD(nextVatDeadlines(new Date())), []);

  const day = (date: Date) => format.dateTime(date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('deadlinesTitle')}
      </h2>
      {d ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-secondary/60 p-3">
            <dt className="text-muted-foreground">{t('monthly', { period: format.dateTime(d.monthly.period, { month: 'long', year: 'numeric' }) })}</dt>
            <dd className="mt-1 font-semibold">
              {day(d.monthly.date)} · {t('inDays', { days: d.monthly.days })}
            </dd>
          </div>
          <div className="rounded-lg bg-secondary/60 p-3">
            <dt className="text-muted-foreground">{t('quarterly', { quarter: d.quarterly.quarter, year: d.quarterly.year })}</dt>
            <dd className="mt-1 font-semibold">
              {day(d.quarterly.date)} · {t('inDays', { days: d.quarterly.days })}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="mt-3 h-16 animate-pulse rounded-lg bg-secondary/60" aria-hidden="true" />
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('deadlinesNote')}</p>
    </section>
  );
}
