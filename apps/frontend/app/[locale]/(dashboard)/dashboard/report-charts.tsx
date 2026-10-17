'use client';

import type { ReactNode } from 'react';
import { BarChart3, ChartArea, ChartLine } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { PeriodStats } from './types';

export const CHART_KINDS = ['bars', 'line', 'area'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
const KIND_ICON = { bars: BarChart3, line: ChartLine, area: ChartArea } as const;

/** Bars / line / area switch for the period chart. */
export function ChartKindSwitch({ value, onChange }: { value: ChartKind; onChange: (kind: ChartKind) => void }) {
  const t = useTranslations('reports');
  return (
    <div className="inline-flex rounded-full border border-border bg-muted/40 p-0.5" role="group" aria-label={t('chartKind.label')}>
      {CHART_KINDS.map((k) => {
        const Icon = KIND_ICON[k];
        return (
          <button
            key={k}
            type="button"
            aria-pressed={value === k}
            title={t(`chartKind.${k}`)}
            onClick={() => onChange(k)}
            className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', value === k ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{t(`chartKind.${k}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Revenue and expenses per day / week / month, as bars, lines or areas (hand-drawn, no chart library). */
export function PeriodChart({ stats, money, kind, extra }: { stats: PeriodStats; money: (n: number) => string; kind: ChartKind; extra?: ReactNode }) {
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
  // Label every bucket while they fit, otherwise every n-th.
  const every = Math.max(1, Math.ceil(stats.series.length / 12));
  const n = Math.max(1, stats.series.length);
  const y = (v: number) => 100 - (Math.max(0, v) / max) * 100;
  const points = (key: 'revenue' | 'expenses') => stats.series.map((b, i) => `${((i + 0.5) / n) * 100},${y(b[key])}`).join(' ');
  const area = (key: 'revenue' | 'expenses') => `M${(0.5 / n) * 100},100 L${points(key).split(' ').join(' L')} L${((n - 0.5) / n) * 100},100 Z`;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
          {t('kpi.revenue')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />
          {t('kpi.expenses')}
        </span>
        <span className="text-muted-foreground">{t(`grain.${stats.grain}`)}</span>
        {extra && <span className="ml-auto">{extra}</span>}
      </div>
      <div className="relative mt-2 h-40" role="img" aria-label={t('title')}>
        {kind !== 'bars' && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-[calc(100%-1rem)] w-full overflow-visible" aria-hidden="true">
            {kind === 'area' && (
              <>
                <path d={area('expenses')} className="fill-muted-foreground/20" />
                <path d={area('revenue')} className="fill-primary/25" />
              </>
            )}
            <polyline points={points('expenses')} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" className="stroke-muted-foreground/60" />
            <polyline points={points('revenue')} fill="none" strokeWidth={2.5} vectorEffect="non-scaling-stroke" className="stroke-primary" />
          </svg>
        )}
        <div className="absolute inset-0 flex items-end gap-px sm:gap-1">
          {stats.series.map((b, i) => (
            <div key={b.start} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="flex h-full items-end justify-center gap-px group-hover:bg-secondary/40">
                {kind === 'bars' && (
                  <>
                    <div className="w-1/2 max-w-4 rounded-t bg-primary transition-opacity group-hover:opacity-80" style={{ height: `${(Math.max(0, b.revenue) / max) * 100}%` }} />
                    <div className="w-1/2 max-w-4 rounded-t bg-muted-foreground/40" style={{ height: `${(b.expenses / max) * 100}%` }} />
                  </>
                )}
              </div>
              <span className="mt-1 h-3 whitespace-nowrap text-center text-[10px] text-muted-foreground">{i % every === 0 ? label(b.start) : ''}</span>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-[11px] text-background shadow group-hover:block">
                {label(b.start)}: {money(b.revenue)} / {money(b.expenses)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Slice colours; the last one is kept for "others". */
const SLICE_COLORS = ['text-primary', 'text-sky-500', 'text-amber-500', 'text-emerald-500', 'text-rose-500', 'text-violet-500'];
const OTHERS_COLOR = 'text-muted-foreground/50';

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** Fixed colour class (e.g. paid = green), else picked by position. */
  color?: string;
  sub?: string;
}

/** A donut with its legend: label, amount and share. Zero and negative slices are left out. */
export function Donut({ title, slices, money, empty }: { title: string; slices: Slice[]; money: (n: number) => string; empty: string }) {
  const shown = slices.filter((s) => s.value > 0);
  const sum = shown.reduce((a, s) => a + s.value, 0);
  // r = 100 / 2π, so the circumference is 100 and dash lengths are percentages.
  const r = 15.9155;
  let offset = 0;
  const colorOf = (s: Slice, i: number) => s.color ?? (s.key === 'others' ? OTHERS_COLOR : SLICE_COLORS[i % SLICE_COLORS.length]);
  return (
    <div className="rounded-lg border border-border p-3">
      <h3 className="text-sm font-bold">{title}</h3>
      {sum <= 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <svg viewBox="0 0 42 42" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={title}>
            <circle cx="21" cy="21" r={r} fill="none" strokeWidth="7" className="stroke-secondary" />
            {shown.map((s, i) => {
              const pct = (s.value / sum) * 100;
              const el = (
                <circle
                  key={s.key}
                  cx="21"
                  cy="21"
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeDasharray={`${pct} ${100 - pct}`}
                  strokeDashoffset={-offset}
                  className={colorOf(s, i)}
                >
                  <title>{`${s.label}: ${money(s.value)}`}</title>
                </circle>
              );
              offset += pct;
              return el;
            })}
          </svg>
          <ul className="min-w-0 flex-1 space-y-1 text-xs">
            {shown.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm bg-current', colorOf(s, i))} />
                <span className="min-w-0 flex-1 truncate" title={s.label}>
                  {s.label}
                  {s.sub && <span className="text-muted-foreground"> · {s.sub}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round((s.value / sum) * 100)} %</span>
                <span className="hidden shrink-0 font-semibold tabular-nums sm:inline">{money(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
