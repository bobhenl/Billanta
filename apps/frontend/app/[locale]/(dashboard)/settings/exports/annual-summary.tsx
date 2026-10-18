'use client';

import { useEffect, useState } from 'react';
import { Calculator, Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { inputClass } from '@/components/modal';
import { cn } from '@/lib/utils';

interface Part {
  base: number;
  total: number;
  paid: number | null;
  balance: number | null;
  nextAdvance: number;
}

interface Summary {
  year: number;
  params: { averageWage: number; paramsYear: number; exact: boolean };
  income: number;
  actualExpenses: number;
  flatRate: number | null;
  flatExpenses: number | null;
  expenses: number;
  profit: number;
  tax: { base: number; beforeCredit: number; credit: number; total: number };
  social: Part;
  health: Part;
  totalBurden: number;
  vatPayer: boolean;
  counts: { invoices: number; expenses: number; missingRates: number };
  /** Where `paid` came from: the typed amount, or the advances in Settings (each month as it applied then). Missing on an older backend. */
  paidSource?: Record<'social' | 'health', 'input' | 'settings' | null>;
}

const EXPENSE_MODES = ['60', '80', '40', '30', 'actual'] as const;

/**
 * OSVČ year estimate: income tax (DPFO), social and health insurance and
 * next year's advances, from paid invoices and expenses of the year.
 */
export function AnnualSummary() {
  const t = useTranslations('settings.exports.annual');
  const locale = useLocale();
  const now = new Date();
  // Before the filing deadlines (spring) the previous year is the interesting one.
  const [year, setYear] = useState(String(now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear()));
  const [mode, setMode] = useState<(typeof EXPENSE_MODES)[number]>('60');
  const [paidSocial, setPaidSocial] = useState('');
  const [paidHealth, setPaidHealth] = useState('');
  // A paid field filled from the advances in Settings (not typed): re-filled for another year.
  const [prefilled, setPrefilled] = useState({ social: false, health: false });
  const [data, setData] = useState<Summary | null | undefined>(undefined);
  const years = Array.from({ length: 4 }, (_, i) => String(now.getFullYear() - i));

  const params = new URLSearchParams({ year, expenses: mode });
  if (paidSocial) params.set('paidSocial', paidSocial);
  if (paidHealth) params.set('paidHealth', paidHealth);
  const query = params.toString();

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/files/exports/annual-summary?${query}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json: Summary | null) => alive && setData(json))
        .catch(() => alive && setData(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  // An empty paid field: the backend sums the advances from Settings over the
  // months of the year (each with the amount in force then); put that sum in
  // the field so it can be checked and edited.
  useEffect(() => {
    if (!data?.paidSource) return;
    const fill = (kind: 'social' | 'health', current: string, set: (v: string) => void) => {
      if (current || data.paidSource![kind] !== 'settings' || data[kind].paid == null) return;
      set(String(Math.round(data[kind].paid!)));
      setPrefilled((p) => ({ ...p, [kind]: true }));
    };
    fill('social', paidSocial, setPaidSocial);
    fill('health', paidHealth, setPaidHealth);
    // Only a fresh response decides; the fields themselves are read as they are then.
  }, [data]);

  const czk = new Intl.NumberFormat(locale, { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
  const row = (label: string, value: number | null, opts?: { strong?: boolean; hint?: string; tone?: string }) =>
    value == null ? null : (
      <div className={cn('flex items-baseline justify-between gap-3 py-1.5', opts?.strong && 'font-bold')}>
        <span className="text-muted-foreground">{opts?.hint ? <InfoHint hint={opts.hint}>{label}</InfoHint> : label}</span>
        <span className={cn('tabular-nums', opts?.tone)}>{czk.format(value)}</span>
      </div>
    );
  const fromSettings = (kind: 'social' | 'health') =>
    prefilled[kind] ? <span className="block text-xs text-muted-foreground">{t('paidFromSettings')}</span> : null;
  const balanceTone =(v: number | null) => (v == null ? undefined : v > 0 ? 'text-destructive' : 'text-success');

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Calculator className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div>
          <h2 className="font-bold">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('hint')}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <label className="space-y-1">
          <span className="font-semibold">{t('year')}</span>
          <select
            className={inputClass}
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              // Amounts from Settings belong to the old year: clear them so the new year's sum fills in.
              if (prefilled.social) setPaidSocial('');
              if (prefilled.health) setPaidHealth('');
            }}
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-semibold">
            <InfoHint hint={t('expensesHint')}>{t('expenses')}</InfoHint>
          </span>
          <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            {EXPENSE_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`modes.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-semibold">
            <InfoHint hint={t('paidHint')}>{t('paidSocial')}</InfoHint>
          </span>
          <input
            className={inputClass}
            inputMode="numeric"
            value={paidSocial}
            onChange={(e) => {
              setPaidSocial(e.target.value.replace(/[^\d]/g, ''));
              setPrefilled((p) => ({ ...p, social: false }));
            }}
            placeholder="0"
          />
          {fromSettings('social')}
        </label>
        <label className="space-y-1">
          <span className="font-semibold">{t('paidHealth')}</span>
          <input
            className={inputClass}
            inputMode="numeric"
            value={paidHealth}
            onChange={(e) => {
              setPaidHealth(e.target.value.replace(/[^\d]/g, ''));
              setPrefilled((p) => ({ ...p, health: false }));
            }}
            placeholder="0"
          />
          {fromSettings('health')}
        </label>
      </div>

      {data === null && <p className="mt-4 text-sm text-destructive">{t('failed')}</p>}
      {data && (
        <>
          <div className="mt-5 grid gap-4 text-sm md:grid-cols-2">
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              {row(t('income'), data.income, { hint: t(data.vatPayer ? 'incomeHintVat' : 'incomeHint', { invoices: data.counts.invoices }) })}
              {row(t('actualExpenses'), data.actualExpenses)}
              {data.flatExpenses != null && row(t('flatExpenses', { rate: data.flatRate ?? 0 }), data.flatExpenses)}
              {row(t('profit'), data.profit, { strong: true })}
              {row(t('taxBase'), data.tax.base)}
              {row(t('taxCredit'), -data.tax.credit)}
              {row(t('incomeTax'), data.tax.total, { strong: true, hint: t('incomeTaxHint') })}
            </div>
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              {row(t('social'), data.social.total, { strong: true, hint: t('socialHint') })}
              {row(t('balance'), data.social.balance, { tone: balanceTone(data.social.balance) })}
              {row(t('nextAdvance'), data.social.nextAdvance)}
              {row(t('health'), data.health.total, { strong: true, hint: t('healthHint') })}
              {row(t('balance'), data.health.balance, { tone: balanceTone(data.health.balance) })}
              {row(t('nextAdvance'), data.health.nextAdvance)}
              {row(t('total'), data.totalBurden, { strong: true })}
            </div>
          </div>
          {data.counts.missingRates > 0 && <p className="mt-2 text-xs text-warning">{t('missingRates', { count: data.counts.missingRates, source: 'ČNB' })}</p>}
          {!data.params.exact && <p className="mt-2 text-xs text-warning">{t('paramsFallback', { year: data.params.paramsYear })}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={`/api/files/exports/annual-summary.csv?${query}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-primary hover:text-primary"
            >
              <Download className="h-4 w-4" />
              {t('downloadCsv')}
            </a>
            <a href="https://adisspr.mfcr.cz/pmd/epo/formulare" target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline">
              {t('epoLink')}
            </a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('disclaimer')}</p>
        </>
      )}
    </section>
  );
}
