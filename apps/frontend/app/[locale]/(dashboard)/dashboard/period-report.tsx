'use client';

import { useEffect, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Download, Loader2, Settings2, X } from 'lucide-react';
import { DragHandle, moveBy, useDragSort } from '@/components/drag-sort';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/invoice-ui';
import { PERIOD_PRESETS, presetRange, type PeriodPreset } from '@/lib/period-presets';
import { reportQuery } from '@/lib/report-query';
import { cn } from '@/lib/utils';
import { Modal, buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { EXPENSE_KPIS, REPORT_KPIS, recommendReportKpis, reportKpisOf, type ReportKpi, type Usage } from '@/lib/usage-defaults';
import { fetchPeriodStats, saveDashboardConfig } from './actions';
import { ChartKindSwitch, Donut, PeriodChart, type ChartKind } from './report-charts';
import { REPORT_DOC_TYPES, REPORT_STATUSES, type PeriodStats, type ReportFilters } from './types';

const CHART_KIND_KEY = 'billanta.reports.chartKind';

/**
 * Revenue, expenses and profit for a chosen period, each against the
 * same-length period right before it, with a chart by day / week / month
 * and the period's best customers. `compact` is the dashboard card; the
 * reports page shows everything, plus filters, pie charts and the CSV.
 */
export function PeriodReport({
  initial,
  initialPreset = 'last12',
  compact = false,
  usage = null,
  savedKpis = null
}: {
  initial: PeriodStats;
  initialPreset?: PeriodPreset;
  compact?: boolean;
  /** What the company uses: hides VAT for non-payers, expenses when there are none, filters with one option. */
  usage?: Usage | null;
  /** The member's own KPI choice for the full report (dashboard config `reportKpis`); null = from usage. */
  savedKpis?: string[] | null;
}) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const [stats, setStats] = useState(initial);
  const [preset, setPreset] = useState<PeriodPreset | 'custom'>(initialPreset);
  const [range, setRange] = useState(() => presetRange(initialPreset, new Date(), initial.earliest));
  const [filters, setFilters] = useState<ReportFilters>({});
  const [chartKind, setChartKindState] = useState<ChartKind>('bars');
  // Read after mount, so the server render and the first client render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CHART_KIND_KEY);
      if (saved === 'line' || saved === 'area') setChartKindState(saved);
    } catch {
      // Storage blocked: stay on bars.
    }
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const [kpiChoice, setKpiChoice] = useState<string[] | null>(savedKpis);
  const [customizing, setCustomizing] = useState(false);
  const noExpenses = !!usage && !usage.has.expenses;
  const money = (n: number) => formatMoney(n, stats.currency, locale);

  const setChartKind = (kind: ChartKind) => {
    setChartKindState(kind);
    try {
      window.localStorage.setItem(CHART_KIND_KEY, kind);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  };

  /** `allTime`: the "Celkem" chip, whose start the backend finds (and which has nothing to compare with). */
  const load = (next: { from: string; to: string }, nextFilters = filters, allTime = preset === 'all') => {
    setRange(next);
    setFilters(nextFilters);
    if (!next.from || !next.to || next.from > next.to) return;
    start(async () => {
      const res = await fetchPeriodStats(next.from, next.to, nextFilters, allTime);
      if (res.ok) {
        setStats(res.stats);
        setError(null);
        if (allTime && res.stats.earliest) setRange((r) => ({ ...r, from: res.stats.earliest! }));
      } else setError(res.error);
    });
  };
  const allTime = preset === 'all';
  const setFilter = <K extends keyof ReportFilters>(key: K, value: string) =>
    load(range, { ...filters, [key]: value || undefined } as ReportFilters);
  const anyFilter = Object.values(filters).some(Boolean);

  const { current, previous } = stats;
  const all: { key: ReportKpi; value: string; now: number; before: number; invert?: boolean; sub?: string }[] = [
    { key: 'revenue', value: money(current.revenue), now: current.revenue, before: previous.revenue },
    { key: 'expenses', value: money(current.expenses), now: current.expenses, before: previous.expenses, invert: true },
    { key: 'profit', value: money(current.profit), now: current.profit, before: previous.profit },
    {
      key: 'collected',
      value: money(current.collected),
      now: current.collected,
      before: previous.collected,
      sub: t('paidCount', { count: current.paidCount })
    },
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
    },
    {
      key: 'outstanding',
      value: money(current.outstanding),
      now: current.outstanding,
      before: previous.outstanding,
      invert: true,
      sub: t('docCount', { count: current.outstandingCount })
    },
    {
      key: 'overdue',
      value: money(current.overdue),
      now: current.overdue,
      before: previous.overdue,
      invert: true,
      sub: t('docCount', { count: current.overdueCount })
    },
    {
      key: 'customers',
      value: String(current.customerCount),
      now: current.customerCount,
      before: previous.customerCount
    },
    { key: 'newCustomers', value: String(current.newCustomers), now: current.newCustomers, before: previous.newCustomers }
  ];
  // The dashboard card: four KPIs, without expenses / profit for a company that records none.
  const compactKeys: ReportKpi[] = noExpenses ? ['revenue', 'collected', 'invoiceCount', 'averageInvoice'] : ['revenue', 'expenses', 'profit', 'collected'];
  const visible = compact ? compactKeys : reportKpisOf(kpiChoice, usage);
  const kpis = visible.map((key) => all.find((k) => k.key === key)!).filter(Boolean);
  const showCurrencyFilter = stats.options.currencies.length > 1 || !!filters.currency;
  const showLanguageFilter = stats.options.languages.length > 1 || !!filters.language;
  const showCustomerFilter = stats.options.customers.length > 1 || !!filters.contactId;
  const showTypeFilter = !usage || usage.has.proformas || usage.has.creditNotes || !!filters.documentType;

  const typeLabel = (type: string) => t(`docTypes.${type as (typeof REPORT_DOC_TYPES)[number]}`);
  const select = 'rounded-md border border-border bg-background px-2 py-1 text-xs';
  const exportHref = `/api/files/exports/invoices.csv?${reportQuery(range.from, range.to, filters, { dateBy: 'supply' })}`;

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
        {compact ? (
          <Link href="/reports" className="text-xs font-semibold text-primary hover:underline">
            {t('openReports')}
          </Link>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCustomizing(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('customize.button')}
            </button>
            <a
              href={range.from && range.to && range.from <= range.to ? exportHref : undefined}
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-primary hover:border-primary"
              title={t('exportHint')}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t('exportCsv')}
            </a>
          </span>
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
              load(presetRange(p, new Date(), stats.earliest), filters, p === 'all');
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
              load({ ...range, from: e.target.value }, filters, false);
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
              load({ ...range, to: e.target.value }, filters, false);
            }}
            className="rounded-md border border-border bg-background px-1.5 py-0.5"
          />
        </span>
      </div>

      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('filters.label')}>
          {showCurrencyFilter && (
            <select aria-label={t('filters.currency')} className={select} value={filters.currency ?? ''} onChange={(e) => setFilter('currency', e.target.value)}>
              <option value="">{t('filters.allCurrencies')}</option>
              {stats.options.currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {showLanguageFilter && (
            <select aria-label={t('filters.language')} className={select} value={filters.language ?? ''} onChange={(e) => setFilter('language', e.target.value)}>
              <option value="">{t('filters.allLanguages')}</option>
              {stats.options.languages.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          )}
          {showCustomerFilter && (
            <select
              aria-label={t('filters.customer')}
              className={cn(select, 'max-w-[14rem]')}
              value={filters.contactId ?? ''}
              onChange={(e) => setFilter('contactId', e.target.value)}
            >
              <option value="">{t('filters.allCustomers')}</option>
              {stats.options.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {showTypeFilter && (
            <select aria-label={t('filters.type')} className={select} value={filters.documentType ?? ''} onChange={(e) => setFilter('documentType', e.target.value)}>
              <option value="">{t('filters.allTypes')}</option>
              {REPORT_DOC_TYPES.map((d) => (
                <option key={d} value={d}>
                  {typeLabel(d)}
                </option>
              ))}
            </select>
          )}
          <select aria-label={t('filters.status')} className={select} value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">{t('filters.allStatuses')}</option>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
          {anyFilter && (
            <button type="button" onClick={() => load(range, {})} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t('filters.clear')}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className={cn('mt-4 grid grid-cols-2 gap-2', compact ? 'lg:grid-cols-4' : 'sm:grid-cols-4')}>
        {kpis.map((k) => {
          // Chosen by the member although nothing is recorded: shown dimmed, with the reason.
          const dim = noExpenses && EXPENSE_KPIS.includes(k.key);
          return (
            <div key={k.key} className={cn('rounded-lg bg-secondary/60 px-3 py-2', dim && 'opacity-60')}>
              <p className="text-[11px] font-semibold text-muted-foreground">{t(`kpi.${k.key}`)}</p>
              <p className="mt-0.5 text-base font-bold tabular-nums">{k.value}</p>
              {dim ? (
                <p className="text-[11px] text-muted-foreground">{t('customize.noExpensesHint')}</p>
              ) : (
                // All time has no period before it to compare with.
                !allTime && <Change now={k.now} before={k.before} invert={k.invert} label={t('vsPrevious')} />
              )}
              {k.sub && <p className="text-[11px] text-muted-foreground">{k.sub}</p>}
            </div>
          );
        })}
      </div>

      <PeriodChart stats={stats} money={money} kind={compact ? 'bars' : chartKind} extra={compact ? undefined : <ChartKindSwitch value={chartKind} onChange={setChartKind} />} />

      <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        {stats.currency !== 'CZK' && <p>{t('inCurrency', { currency: stats.currency })}</p>}
        {stats.convertedCount > 0 && <p>{t('converted', { count: stats.convertedCount })}</p>}
        {stats.missingRateCount > 0 && <p>{t('missingRate', { count: stats.missingRateCount })}</p>}
        {!compact && !stats.expensesFiltered && !noExpenses && <p>{t('expensesUnfiltered')}</p>}
        {!compact && <p>{t('outstandingHint')}</p>}
      </div>

      {!compact && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Donut
            title={t('pies.customers')}
            money={money}
            empty={t('pies.empty')}
            slices={stats.byCustomer.map((s) => ({ key: s.key, label: s.label ?? t('pies.others'), value: s.value }))}
          />
          {stats.byCurrency.length > 1 && (
            <Donut
              title={t('pies.currencies')}
              money={money}
              empty={t('pies.empty')}
              slices={stats.byCurrency
                .filter((c) => c.converted != null)
                .map((c) => ({
                  key: c.currency,
                  label: c.currency,
                  value: c.converted!,
                  sub: c.currency === stats.currency ? undefined : formatMoney(c.amount, c.currency, locale)
                }))}
            />
          )}
          <Donut
            title={t('pies.types')}
            money={money}
            empty={t('pies.empty')}
            slices={stats.byType.map((s) => ({ key: s.documentType, label: typeLabel(s.documentType), value: s.total, sub: t('docCount', { count: s.count }) }))}
          />
          <Donut
            title={t('pies.payment')}
            money={money}
            empty={t('pies.empty')}
            slices={[
              { key: 'paid', label: t('statuses.paid'), value: stats.payment.paid, color: 'text-emerald-500' },
              { key: 'unpaid', label: t('pies.unpaidNotDue'), value: stats.payment.unpaid, color: 'text-amber-500' },
              { key: 'overdue', label: t('statuses.overdue'), value: stats.payment.overdue, color: 'text-rose-500' }
            ]}
          />
        </div>
      )}

      {!compact && stats.byCurrency.length > 1 && (
        <div className="mt-5">
          <h3 className="text-sm font-bold">{t('byCurrency')}</h3>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {stats.byCurrency.map((c) => (
                <tr key={c.currency} className="border-t border-border first:border-t-0">
                  <td className="py-1.5 font-medium">{c.currency}</td>
                  <td className="py-1.5 text-xs text-muted-foreground">{t('docCount', { count: c.count })}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(c.amount, c.currency, locale)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{c.converted == null ? t('noRate') : money(c.converted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
      {!compact && (
        <KpiCustomizer
          open={customizing}
          onClose={() => setCustomizing(false)}
          usage={usage}
          saved={kpiChoice}
          onSaved={(next) => {
            setKpiChoice(next);
            setCustomizing(false);
          }}
        />
      )}
    </section>
  );
}

/** Show, hide and order the report's KPI cards, saved with the member's dashboard layout. */
function KpiCustomizer({
  open,
  onClose,
  usage,
  saved,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  usage: Usage | null;
  saved: string[] | null;
  onSaved: (next: string[] | null) => void;
}) {
  const t = useTranslations('reports');
  const [chosen, setChosen] = useState<ReportKpi[]>(() => reportKpisOf(saved, usage));
  // Untouched = keep following usage (saved as null).
  const [touched, setTouched] = useState(saved != null);
  const [saving, start] = useTransition();
  const recommended = recommendReportKpis(usage);
  const toggle = (key: ReportKpi) => {
    setTouched(true);
    setChosen((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };
  const reorder = (next: ReportKpi[]) => {
    setTouched(true);
    setChosen(next);
  };
  const sort = useDragSort(chosen, reorder);
  const rest = REPORT_KPIS.filter((k) => !chosen.includes(k));
  /** Why the usage-based defaults leave a figure out. */
  const tagOf = (key: ReportKpi) =>
    recommended.includes(key) ? null : key === 'vat' && usage?.vatStatus === 'non_payer' ? t('customize.notVatPayer') : t('customize.notUsed');
  const save = () =>
    start(async () => {
      const next = touched ? chosen : null;
      const res = await saveDashboardConfig({ reportKpis: next });
      if (!res.ok) {
        toast({ text: t('customize.failed', { reason: res.error }), tone: 'err' });
        return;
      }
      toast({ text: t('customize.saved'), tone: 'ok' });
      onSaved(next);
    });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('customize.title')}
      className="max-w-md"
      footer={
        <>
          <button
            type="button"
            className={cn(buttonClass.ghost, 'mr-auto')}
            disabled={saving}
            onClick={() => {
              setChosen(recommended);
              setTouched(false);
            }}
          >
            {t('customize.reset')}
          </button>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {t('customize.cancel')}
          </button>
          <button type="button" className={buttonClass.primary} disabled={saving} onClick={save}>
            {t('customize.save')}
          </button>
        </>
      }
    >
      {usage && (
        <div className="mb-4 rounded-lg bg-secondary/60 px-3 py-2 text-xs">
          <p className="font-semibold">{t('customize.recommendedTitle')}</p>
          <p className="mt-0.5 text-muted-foreground">
            {[
              usage.has.vat ? null : t(usage.vatStatus === 'identified' ? 'customize.noVatIdentified' : 'customize.noVat'),
              usage.has.expenses ? null : t('customize.noExpenses')
            ]
              .filter(Boolean)
              .join(' ') || t('customize.allRelevant')}
          </p>
        </div>
      )}
      {chosen.length > 1 && <p className="mb-2 text-xs text-muted-foreground">{t('customize.orderHint')}</p>}
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {[...chosen, ...rest].map((key) => {
          const on = chosen.includes(key);
          const i = chosen.indexOf(key);
          const tag = tagOf(key);
          return (
            <li
              key={key}
              {...(on ? sort.itemProps(key) : {})}
              className={cn(
                'flex min-h-11 items-center gap-1 rounded-lg border py-1 pr-1',
                on ? 'border-border bg-card' : 'border-dashed border-border pl-2 opacity-70',
                sort.dragging === key && 'border-primary shadow-md ring-2 ring-primary/20'
              )}
            >
              {on && <DragHandle label={t('customize.dragToReorder')} {...sort.handleProps(key)} />}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={on} onChange={() => toggle(key)} />
                <span className="min-w-0">
                  {t(`kpi.${key}`)}
                  {tag && <span className="ml-1 text-[11px] text-muted-foreground">({tag})</span>}
                </span>
              </label>
              {on && (
                <span className="flex shrink-0">
                  <button
                    type="button"
                    aria-label={t('customize.moveUp')}
                    disabled={i === 0}
                    onClick={() => reorder(moveBy(chosen, key, -1))}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('customize.moveDown')}
                    disabled={i === chosen.length - 1}
                    onClick={() => reorder(moveBy(chosen, key, 1))}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
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
