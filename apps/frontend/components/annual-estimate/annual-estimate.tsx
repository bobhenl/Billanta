'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  computeOsvcAnnualSummary,
  computeSkSzcoAnnualSummary,
  OSVC_FLAT_EXPENSE_CAPS,
  osvcMinSocialAdvance,
  osvcParamsFor,
  SK_FLAT_EXPENSE_CAP,
  type OsvcFlatRate
} from '@faktur/cz-compliance';
import { AmountField, parseAmount, SelectField } from '@/components/public-tools/fields';
import { InfoHint } from '@/components/info-hint';
import { cn } from '@/lib/utils';

export type EstimateCountry = 'CZ' | 'SK';

const CZ_MODES = ['60', '80', '40', '30', 'actual'] as const;
const SK_MODES = ['60', 'actual'] as const;
type Mode = (typeof CZ_MODES)[number];

export interface EstimateDefaults {
  income?: number;
  actualExpenses?: number;
  paidSocial?: number | null;
  paidHealth?: number | null;
  mode?: Mode;
}

interface Row {
  key: string;
  label: string;
  value: number | null;
  strong?: boolean;
  hint?: string;
  tone?: string;
  /** Text shown instead of an amount (e.g. "neplatíte"). */
  text?: string;
  suffix?: string;
}

/**
 * The yearly tax and insurance estimate for a sole trader, Czech (OSVČ) or
 * Slovak (SZČO). One component for the dashboard card and the public
 * calculator pages: the dashboard passes the company's own numbers as
 * defaults, the public pages start from an example. The math is the pure
 * @faktur/cz-compliance functions, run here in the browser, so the two can
 * never disagree and the CSV holds exactly the rows on screen.
 */
export function AnnualEstimate({
  country,
  years,
  defaultYear,
  onYearChange,
  defaults,
  defaultsKey,
  busy,
  incomeHint,
  paidNote,
  notes,
  actions
}: {
  country: EstimateCountry;
  years: readonly number[];
  defaultYear: number;
  /** The dashboard reloads the company's figures for the new year. */
  onYearChange?: (year: number) => void;
  defaults: EstimateDefaults;
  /** The input fields are reset to `defaults` whenever this changes. */
  defaultsKey?: string;
  busy?: boolean;
  incomeHint?: string;
  /** Shown under a paid field while it still holds the default (e.g. "from your advances"). */
  paidNote?: string;
  notes?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const t = useTranslations('annualEstimate');
  const locale = useLocale();
  const sk = country === 'SK';
  const digits = sk ? 2 : 0;
  const fmtInput = (n: number | null | undefined) =>
    n == null || n === 0 ? '' : new Intl.NumberFormat(locale, { maximumFractionDigits: digits, useGrouping: true }).format(n);

  const initial = useMemo(
    () => ({
      income: fmtInput(defaults.income),
      expenses: fmtInput(defaults.actualExpenses),
      paidSocial: fmtInput(defaults.paidSocial),
      paidHealth: fmtInput(defaults.paidHealth)
    }),
    // Only a new set of defaults resets the fields, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultsKey, locale]
  );
  const [year, setYear] = useState(String(defaultYear));
  const [mode, setMode] = useState<Mode>(defaults.mode ?? '60');
  const [fromMonth, setFromMonth] = useState('1');
  const [income, setIncome] = useState(initial.income);
  const [expenses, setExpenses] = useState(initial.expenses);
  const [paidSocial, setPaidSocial] = useState(initial.paidSocial);
  const [paidHealth, setPaidHealth] = useState(initial.paidHealth);

  useEffect(() => {
    setIncome(initial.income);
    setExpenses(initial.expenses);
    setPaidSocial(initial.paidSocial);
    setPaidHealth(initial.paidHealth);
  }, [initial]);

  const y = Number(year);
  const months = 13 - Number(fromMonth);
  const opt = (v: string) => (v.trim() ? parseAmount(v) : undefined);
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: sk ? 'EUR' : 'CZK', minimumFractionDigits: digits, maximumFractionDigits: digits });
  const whole = new Intl.NumberFormat(locale, { style: 'currency', currency: sk ? 'EUR' : 'CZK', maximumFractionDigits: 0 });
  const tone = (v: number | null) => (v == null ? undefined : v > 0 ? 'text-destructive' : 'text-success');

  const rows = useMemo((): Row[][] => {
    const base = { year: y, income: parseAmount(income), actualExpenses: parseAmount(expenses), paidSocial: opt(paidSocial), paidHealth: opt(paidHealth), activeMonths: months };
    if (sk) {
      const r = computeSkSzcoAnnualSummary({ ...base, flatRate: mode !== 'actual' });
      const social: Row =
        r.social.mode === 'none'
          ? { key: 'social', label: t('sk.social', { year: r.social.fromJuly }), value: 0, text: t('sk.socialNone'), strong: true, hint: t('sk.socialHint') }
          : { key: 'social', label: t('sk.social', { year: r.social.fromJuly }), value: r.social.monthly, suffix: t('perMonth'), strong: true, hint: t(r.social.mode === 'micro' ? 'sk.socialMicroHint' : 'sk.socialHint') };
      return [
        [
          { key: 'income', label: t('income'), value: r.income },
          r.flatExpenses != null ? { key: 'expenses', label: t('sk.flatExpenses'), value: r.flatExpenses } : { key: 'expenses', label: t('actualExpenses'), value: r.expenses },
          { key: 'insurance', label: t('sk.paidInsurance'), value: -r.tax.paidInsurance },
          { key: 'taxBase', label: t('sk.taxBase'), value: r.tax.base, strong: true },
          { key: 'allowance', label: t('sk.allowance'), value: -r.tax.allowance },
          { key: 'taxable', label: t('sk.taxable'), value: r.tax.taxable },
          { key: 'tax', label: t(r.tax.reducedRate ? 'sk.incomeTaxReduced' : 'sk.incomeTax'), value: r.tax.total, strong: true, hint: t('sk.incomeTaxHint') }
        ],
        [
          { key: 'health', label: t('sk.health'), value: r.health.total, strong: true, hint: t('sk.healthHint', { rate: Math.round(r.health.rate * 100) }) },
          { key: 'healthBalance', label: t('balance'), value: r.health.balance, tone: tone(r.health.balance) },
          { key: 'healthNext', label: t('nextAdvance'), value: r.health.nextAdvance },
          social,
          { key: 'total', label: t('sk.total'), value: r.totalBurden, strong: true, hint: t('sk.totalHint') }
        ]
      ];
    }
    const r = computeOsvcAnnualSummary({ ...base, flatRate: mode === 'actual' ? null : (Number(mode) as OsvcFlatRate) });
    return [
      [
        { key: 'income', label: t('income'), value: r.income },
        r.flatExpenses != null ? { key: 'expenses', label: t('cz.flatExpenses', { rate: r.flatRate ?? 0 }), value: r.flatExpenses } : { key: 'expenses', label: t('actualExpenses'), value: r.expenses },
        { key: 'profit', label: t('cz.profit'), value: r.profit, strong: true },
        { key: 'taxBase', label: t('cz.taxBase'), value: r.tax.base },
        { key: 'credit', label: t('cz.taxCredit'), value: -r.tax.credit },
        { key: 'tax', label: t('cz.incomeTax'), value: r.tax.total, strong: true, hint: t('cz.incomeTaxHint') }
      ],
      [
        { key: 'social', label: t('cz.social'), value: r.social.total, strong: true, hint: t('cz.socialHint') },
        { key: 'socialBalance', label: t('balance'), value: r.social.balance, tone: tone(r.social.balance) },
        { key: 'socialNext', label: t('nextAdvance'), value: r.social.nextAdvance },
        { key: 'health', label: t('cz.health'), value: r.health.total, strong: true, hint: t('cz.healthHint') },
        { key: 'healthBalance', label: t('balance'), value: r.health.balance, tone: tone(r.health.balance) },
        { key: 'healthNext', label: t('nextAdvance'), value: r.health.nextAdvance },
        { key: 'total', label: t('total'), value: r.totalBurden, strong: true }
      ]
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sk, y, income, expenses, paidSocial, paidHealth, months, mode, locale]);

  const params = useMemo(() => {
    if (sk) {
      const r = computeSkSzcoAnnualSummary({ year: y, income: 0, actualExpenses: 0, flatRate: true });
      const p = r.params;
      return {
        text: t('sk.params', { year: p.paramsYear, zm: money.format(p.subsistenceMinimum), cap: whole.format(SK_FLAT_EXPENSE_CAP) }),
        fallback: !p.exact ? t('paramsFallback', { year: p.paramsYear }) : !p.socialExact ? t('sk.socialFallback', { year: p.socialRegimeYear }) : null
      };
    }
    const p = osvcParamsFor(y);
    const fmt = new Intl.NumberFormat(locale);
    const change = p.minSocialShareFrom
      ? ' ' +
        t('cz.paramsShareChange', {
          month: p.minSocialShareFrom.fromMonth,
          year: p.year,
          share: Math.round(p.minSocialShareFrom.share * 100),
          advance: fmt.format(osvcMinSocialAdvance(p.year, p.minSocialShareFrom.fromMonth))
        })
      : '';
    return {
      text: t('cz.params', { year: p.year, wage: fmt.format(p.averageWage), credit: fmt.format(p.taxpayerCredit), share: Math.round(p.minSocialShare * 100) }) + change,
      fallback: p.exact ? null : t('paramsFallback', { year: p.year })
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sk, y, locale]);

  function downloadCsv() {
    // Same rows as on screen; Czech Excel wants a BOM, ";" and a decimal comma.
    const num = (n: number) => n.toFixed(digits).replace('.', ',');
    const lines = [
      [t('year'), String(y)],
      [t('start'), months === 12 ? t('startFull') : String(months)],
      ...rows.flat().map((r) => [r.suffix ? `${r.label} (${r.suffix})` : r.label, r.text ?? (r.value == null ? '' : num(r.value))]),
      // A key/value sheet read by people, not imported, so the caveat can sit in its last row (as in the backend's annual-summary.csv).
      [t('csvNote'), t('csvDisclaimer')]
    ];
    const csv = '﻿' + lines.map((l) => l.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t('csvName')}-${y}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const monthLabel = (m: number) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, m - 1, 1)));
  const note = (value: string, initialValue: string) =>
    paidNote && value && value === initialValue ? <span className="mt-1 block text-xs text-muted-foreground">{paidNote}</span> : null;
  const modes = sk ? SK_MODES : CZ_MODES;

  return (
    <div>
      <form className="grid gap-4 text-sm sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        <SelectField
          label={t('year')}
          value={year}
          onChange={(v) => {
            setYear(v);
            onYearChange?.(Number(v));
          }}
          options={years.map((v) => ({ value: String(v), label: String(v) }))}
        />
        <AmountField label={t(sk ? 'incomeEur' : 'incomeCzk')} value={income} onChange={setIncome} hint={incomeHint} />
        <div>
          <SelectField
            label={t('expenses')}
            value={mode}
            onChange={setMode}
            options={modes.map((m) => ({
              value: m,
              label:
                m === 'actual'
                  ? t('actualMode')
                  : sk
                    ? t('sk.flatMode', { cap: whole.format(SK_FLAT_EXPENSE_CAP) })
                    : t(`cz.modes.${m}`, { cap: new Intl.NumberFormat(locale).format(OSVC_FLAT_EXPENSE_CAPS[Number(m) as OsvcFlatRate]) })
            }))}
          />
        </div>
        {mode === 'actual' ? <AmountField label={t('actualExpenses')} value={expenses} onChange={setExpenses} hint={sk ? t('sk.actualHint') : undefined} /> : <div className="hidden sm:block" />}
        <div>
          <SelectField
            label={t('start')}
            value={fromMonth}
            onChange={setFromMonth}
            options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? t('startFull') : t('startFrom', { date: monthLabel(i + 1), months: 12 - i }) }))}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t(sk ? 'sk.startHint' : 'cz.startHint')}</p>
        </div>
        <div className="hidden sm:block" />
        <div>
          <AmountField label={t('paidSocial')} value={paidSocial} onChange={setPaidSocial} hint={t(sk ? 'sk.paidSocialHint' : 'paidHint')} />
          {note(paidSocial, initial.paidSocial)}
        </div>
        <div>
          <AmountField label={t('paidHealth')} value={paidHealth} onChange={setPaidHealth} hint={t(sk ? 'sk.paidHealthHint' : 'paidHint')} />
          {note(paidHealth, initial.paidHealth)}
        </div>
      </form>

      <section aria-live="polite" className={cn('mt-6 transition-opacity', busy && 'opacity-60')}>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t('resultTitle')} · {y}
        </h2>
        <div className="mt-2 grid gap-4 text-sm md:grid-cols-2">
          {rows.map((col, i) => (
            <dl key={i} className="divide-y divide-border rounded-lg border border-border px-3">
              {col
                .filter((r) => r.value != null)
                .map((r) => (
                  <div key={r.key} className={cn('flex items-baseline justify-between gap-3 py-1.5', r.strong && 'font-bold')}>
                    <dt className="text-muted-foreground">{r.hint ? <InfoHint hint={r.hint}>{r.label}</InfoHint> : r.label}</dt>
                    <dd className={cn('text-right tabular-nums', r.tone)}>
                      {r.text ?? money.format(r.value || 0)}
                      {r.suffix && !r.text ? <span className="ml-1 font-normal text-muted-foreground">{r.suffix}</span> : null}
                    </dd>
                  </div>
                ))}
            </dl>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{params.text}</p>
        {params.fallback && <p className="mt-1 text-xs text-warning">{params.fallback}</p>}
        {notes}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-primary hover:text-primary"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('downloadCsv')}
          </button>
          {actions}
        </div>
      </section>
    </div>
  );
}
