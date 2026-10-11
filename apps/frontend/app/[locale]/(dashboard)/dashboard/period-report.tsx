'use client';

import { useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/invoice-ui';
import { PERIOD_PRESETS, presetRange, type PeriodPreset } from '@/lib/period-presets';
import { cn } from '@/lib/utils';
import { fetchPeriodStats } from './actions';
import type { PeriodStats } from './types';

/**
 * Revenue, expenses and profit for a chosen period, each against the
 * same-length period right before it, with a bar chart by day / week /
 * month and the period's best customers. `compact` is the dashboard card;
 * the reports page shows everything.
 */
export function PeriodReport({
  initial,
  initialPreset = 'last12',
  compact = false
}: {
  initial: PeriodStats;
  initialPreset?: PeriodPreset;
  compact?: boolean;
}) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const [stats, setStats] = useState(initial);
  const [preset, setPreset] = useState<PeriodPreset | 'custom'>(initialPreset);
  const [range, setRange] = useState(() => presetRange(initialPreset));
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const money = (n: number) => formatMoney(n, stats.currency, locale);

  const load = (next: { from: string; to: string }) => {
    setRange(next);
    if (!next.from || !next.to || next.from > next.to) return;
    start(async () => {
      const res = await fetchPeriodStats(next.from, next.to);
      if (res.ok) {
        setStats(res.stats);
        setError(null);
      } else setError(res.error);
    });
  };

  const { current, previous } = stats;
  const kpis: { key: string; value: string; now: number; before: number; invert?: boolean; sub?: string }[] = [
    { key: 'revenue', value: money(current.revenue), now: current.revenue, before: previous.revenue },
    { key: 'expenses', value: money(current.expenses), now: current.expenses, before: previous.expenses, invert: true },
    { key: 'profit', value: money(current.profit), now: current.profit, before: previous.profit },
    {
      key: 'collected',
      value: money(current.collected),
      now: current.collected,
      before: previous.collected,
      sub: t('paidCount', { count: current.paidCount })
    }
  ];
  if (!compact) {
    kpis.push(
      { key: 'invoiceCount', value: String(current.invoiceCount), now: current.invoiceCount, before: previous.invoiceCount },
      { key: 'averageInvoice', value: money(current.averageInvoice), now: current.averageInvoice, before: previous.averageInvoice },
      { key: 'vat', value: money(current.vat), now: current.vat, before: previous.vat },
      {
        key: 'daysToPay',
        value: current.averageDaysToPay == null ? '–' : t('days', { count: current.averageDaysToPay }),
        now: current.averageDaysToPay ?? 0,
        // No comparison unless both periods had payments.
        before: current.averageDaysToPay == null ? 0 : (previous.averageDaysToPay ?? 0),
        invert: true
      }
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            {t('title')}
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
          </h2>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        {compact && (
          <Link href="/reports" className="text-xs font-semibold text-primary hover:underline">
            {t('openReports')}
          </Link>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={preset === p}
            onClick={() => {
              setPreset(p);
              load(presetRange(p));
            }}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
              preset === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {t(`presets.${p}`)}
          </button>
        ))}
        <span className="flex items-center gap-1 text-xs">
          <input
            type="date"
            aria-label={t('from')}
            value={range.from}
            onChange={(e) => {
              setPreset('custom');
              load({ ...range, from: e.target.value });
            }}
            className="rounded-md border border-border bg-background px-1.5 py-0.5"
          />
          –
          <input
            type="date"
            aria-label={t('to')}
            value={range.to}
            onChange={(e) => {
              setPreset('custom');
              load({ ...range, to: e.target.value });
            }}
            className="rounded-md border border-border bg-background px-1.5 py-0.5"
          />
        </span>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className={cn('mt-4 grid grid-cols-2 gap-2', compact ? 'lg:grid-cols-4' : 'sm:grid-cols-4')}>
        {kpis.map((k) => (
          <div key={k.key} className="rounded-lg bg-secondary/60 px-3 py-2">
            <p className="text-[11px] font-semibold text-muted-foreground">{t(`kpi.${k.key}`)}</p>
            <p className="mt-0.5 text-base font-bold tabular-nums">{k.value}</p>
            <Change now={k.now} before={k.before} invert={k.invert} label={t('vsPrevious')} />
            {k.sub && <p className="text-[11px] text-muted-foreground">{k.sub}</p>}
          </div>
        ))}
      </div>

      <Chart stats={stats} money={money} />

      {stats.foreignCount > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{t('foreign', { count: stats.foreignCount })}</p>}

      {!compact && stats.topCustomers.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-bold">{t('topCustomers')}</h3>
          <ol className="mt-2 space-y-1">
            {stats.topCustomers.map((c, i) => {
              const top = stats.topCustomers[0]?.total ?? 0;
              const share = current.revenue > 0 ? Math.round((c.total / current.revenue) * 100) : 0;
              return (
                <li key={c.contactId}>
                  <Link href={`/contacts/${c.contactId}`} className="block rounded-lg px-2 py-1.5 hover:bg-secondary">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="w-4 text-xs font-bold text-muted-foreground">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{t('customerMeta', { count: c.count, share })}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{money(c.total)}</span>
                    </span>
                    <span className="ml-6 mt-1 block h-1 rounded-full bg-secondary">
                      <span className="block h-1 rounded-full bg-primary" style={{ width: `${top > 0 ? (c.total / top) * 100 : 0}%` }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

function Change({ now, before, invert, label }: { now: number; before: number; invert?: boolean; label: string }) {
  if (before === 0) return <p className="text-[11px] text-muted-foreground">–</p>;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  const good = invert ? pct <= 0 : pct >= 0;
  const Icon = pct >= 0 ? ArrowUp : ArrowDown;
  return (
    <p className={cn('flex items-center gap-0.5 text-[11px] font-semibold', good ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {Math.abs(pct)} %<span className="font-normal text-muted-foreground"> {label}</span>
    </p>
  );
}

function Chart({ stats, money }: { stats: PeriodStats; money: (n: number) => string }) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const max = Math.max(1, ...stats.series.flatMap((b) => [b.revenue, b.expenses]));
  const label = (key: string) => {
    const d = new Date(`${key}T00:00:00`);
    if (stats.grain === 'month') {
      return new Intl.DateTimeFormat(locale, { month: 'short', year: stats.series.length > 12 ? '2-digit' : undefined }).format(d);
    }
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric' }).format(d);
  };
  // Label every bar while they fit, otherwise every n-th.
  const every = Math.max(1, Math.ceil(stats.series.length / 12));

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
          {t('kpi.revenue')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />
          {t('kpi.expenses')}
        </span>
        <span className="text-muted-foreground">{t(`grain.${stats.grain}`)}</span>
      </div>
      <div className="mt-2 flex h-40 items-end gap-px sm:gap-1" role="img" aria-label={t('title')}>
        {stats.series.map((b, i) => (
          <div key={b.start} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-px">
              <div className="w-1/2 max-w-4 rounded-t bg-primary transition-opacity group-hover:opacity-80" style={{ height: `${(b.revenue / max) * 100}%` }} />
              <div className="w-1/2 max-w-4 rounded-t bg-muted-foreground/40" style={{ height: `${(b.expenses / max) * 100}%` }} />
            </div>
            <span className="mt-1 h-3 whitespace-nowrap text-center text-[10px] text-muted-foreground">{i % every === 0 ? label(b.start) : ''}</span>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-[11px] text-background shadow group-hover:block">
              {label(b.start)}: {money(b.revenue)} / {money(b.expenses)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
