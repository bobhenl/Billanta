'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { BANK_PERIODS, type BankPeriod } from '@/lib/bank-ui';
import { cn } from '@/lib/utils';


/** Keys this bar owns in the URL; status and q stay with the chips and the search box. */
const KEYS = ['source', 'period', 'from', 'to', 'dir'] as const;

/**
 * Source, period and direction for the /bank list. Everything lives in the
 * query string, so a shared link or the back button keeps the view. On a
 * phone the selects fold behind one "Filtry" button.
 */
export function BankFilters({
  sources,
  period,
  from,
  to
}: {
  sources: { value: string; label: string }[];
  /** The active preset, `custom` for a from–to range, or '' for all time. */
  period: BankPeriod | 'custom' | '';
  from: string;
  to: string;
}) {
  const t = useTranslations('bank.filters');
  const tp = useTranslations('reports');
  const router = useRouter();
  const params = useSearchParams();
  const source = params.get('source') ?? '';
  const dir = params.get('dir') ?? '';
  const active = KEYS.filter((k) => params.get(k)).length - (params.get('from') && params.get('to') ? 1 : 0);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(period === 'custom');

  const go = (changes: Partial<Record<(typeof KEYS)[number], string | null>>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.push(qs ? `/bank?${qs}` : '/bank', { scroll: false });
  };

  const select = 'h-9 min-w-0 rounded-full border border-input bg-background px-3 text-sm outline-none focus:border-primary';
  const showDates = custom || period === 'custom';

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold sm:hidden',
          open || active > 0 ? 'border-primary text-primary' : 'border-border text-muted-foreground'
        )}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {tp('filters.label')}
        {active > 0 && <span className="tabular-nums">({active})</span>}
      </button>

      <div className={cn('mt-2 flex-wrap items-center gap-2 sm:mt-0 sm:flex', open ? 'flex' : 'hidden')} role="group" aria-label={tp('filters.label')}>
        {sources.length > 1 && (
          <select aria-label={t('source')} className={cn(select, 'max-w-full sm:max-w-[14rem]')} value={source} onChange={(e) => go({ source: e.target.value })}>
            <option value="">{t('allSources')}</option>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label={t('period')}
          className={select}
          value={showDates ? 'custom' : period}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'custom') {
              setCustom(true);
              go({ period: null, from: from || null, to: to || null });
              return;
            }
            setCustom(false);
            go({ period: value || null, from: null, to: null });
          }}
        >
          <option value="">{tp('presets.all')}</option>
          {BANK_PERIODS.map((p) => (
            <option key={p} value={p}>
              {tp(`presets.${p}`)}
            </option>
          ))}
          <option value="custom">{t('custom')}</option>
        </select>
        {showDates && (
          <span className="flex min-w-0 items-center gap-1 text-sm">
            <input type="date" aria-label={tp('from')} value={from} max={to || undefined} onChange={(e) => go({ period: null, from: e.target.value })} className={cn(select, 'w-[9.5rem]')} />
            –
            <input type="date" aria-label={tp('to')} value={to} min={from || undefined} onChange={(e) => go({ period: null, to: e.target.value })} className={cn(select, 'w-[9.5rem]')} />
          </span>
        )}
        <select aria-label={t('direction')} className={select} value={dir} onChange={(e) => go({ dir: e.target.value })}>
          <option value="">{t('allDirections')}</option>
          <option value="in">{t('incoming')}</option>
          <option value="out">{t('outgoing')}</option>
        </select>
        {active > 0 && (
          <button
            type="button"
            onClick={() => {
              setCustom(false);
              go({ source: null, period: null, from: null, to: null, dir: null });
            }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {tp('filters.clear')}
          </button>
        )}
      </div>
    </div>
  );
}
