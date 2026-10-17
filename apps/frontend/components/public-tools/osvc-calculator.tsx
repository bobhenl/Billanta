'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { computeOsvcAnnualSummary, OSVC_FLAT_EXPENSE_CAPS, OSVC_PARAM_YEARS, osvcMinSocialAdvance, osvcParamsFor, type OsvcFlatRate } from '@faktur/cz-compliance';
import { AmountField, money, parseAmount, ResultRow, Segmented, SelectField } from '@/components/public-tools/fields';

const RATES = [80, 60, 40, 30] as const satisfies readonly OsvcFlatRate[];

/**
 * Public OSVČ estimate: the visitor types the numbers, the math is the same
 * `computeOsvcAnnualSummary` the in-app annual summary uses (package
 * @faktur/cz-compliance), so the two can never disagree.
 */
export function OsvcCalculator({ defaultYear }: { defaultYear: number }) {
  const t = useTranslations('tools.calculators.items.osvc');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const [year, setYear] = useState(String(defaultYear));
  const [income, setIncome] = useState('800 000');
  const [mode, setMode] = useState<'flat' | 'actual'>('flat');
  const [flatRate, setFlatRate] = useState<string>('60');
  const [expenses, setExpenses] = useState('');
  const [paidSocial, setPaidSocial] = useState('');
  const [paidHealth, setPaidHealth] = useState('');

  const r = useMemo(
    () =>
      computeOsvcAnnualSummary({
        year: Number(year),
        income: parseAmount(income),
        actualExpenses: parseAmount(expenses),
        flatRate: mode === 'flat' ? (Number(flatRate) as OsvcFlatRate) : null,
        paidSocial: paidSocial.trim() ? parseAmount(paidSocial) : undefined,
        paidHealth: paidHealth.trim() ? parseAmount(paidHealth) : undefined
      }),
    [year, income, mode, flatRate, expenses, paidSocial, paidHealth]
  );
  const params = osvcParamsFor(Number(year));
  const czk = (n: number) => money(locale, n);
  const balance = (b: number | null) => (b == null ? undefined : b >= 0 ? t('result.toPay', { amount: czk(b) }) : t('result.overpaid', { amount: czk(-b) }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <SelectField label={t('fields.year')} value={year} onChange={setYear} options={OSVC_PARAM_YEARS.map((y) => ({ value: String(y), label: String(y) }))} />
        <AmountField label={t('fields.income')} value={income} onChange={setIncome} />
        <Segmented
          label={t('fields.expenseMode')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'flat', label: t('fields.flat') },
            { value: 'actual', label: t('fields.actual') }
          ]}
        />
        {mode === 'flat' ? (
          <SelectField
            label={t('fields.flatRate')}
            value={flatRate}
            onChange={setFlatRate}
            options={RATES.map((rate) => ({ value: String(rate), label: t(`rates.${rate}`, { cap: new Intl.NumberFormat(locale).format(OSVC_FLAT_EXPENSE_CAPS[rate]) }) }))}
          />
        ) : (
          <AmountField label={t('fields.expenses')} value={expenses} onChange={setExpenses} />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountField label={t('fields.paidSocial')} value={paidSocial} onChange={setPaidSocial} />
          <AmountField label={t('fields.paidHealth')} value={paidHealth} onChange={setPaidHealth} />
        </div>
      </form>

      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {tc('resultTitle')} · {r.year}
        </h2>
        <dl className="mt-3 text-sm">
          <ResultRow label={t('result.expenses')} value={czk(r.expenses)} />
          <ResultRow label={t('result.profit')} value={czk(r.profit)} />
          <ResultRow label={t('result.tax')} value={czk(r.tax.total)} />
          <ResultRow label={t('result.social')} value={czk(r.social.total)} note={balance(r.social.balance)} />
          <ResultRow label={t('result.health')} value={czk(r.health.total)} note={balance(r.health.balance)} />
          <ResultRow label={t('result.total')} value={czk(r.totalBurden)} strong />
          <ResultRow label={t('result.nextSocial')} value={`${czk(r.social.nextAdvance)} ${tc('perMonth')}`} />
          <ResultRow label={t('result.nextHealth')} value={`${czk(r.health.nextAdvance)} ${tc('perMonth')}`} />
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          {t('params', {
            year: params.year,
            wage: new Intl.NumberFormat(locale).format(params.averageWage),
            credit: new Intl.NumberFormat(locale).format(params.taxpayerCredit),
            share: Math.round(params.minSocialShare * 100)
          })}
          {/* Same mid-year change the statutory minimums table has (2026: 35 % and 5 005 Kč from July). */}
          {params.minSocialShareFrom ? (
            <>
              {' '}
              {t('paramsShareChange', {
                month: params.minSocialShareFrom.fromMonth,
                year: params.year,
                share: Math.round(params.minSocialShareFrom.share * 100),
                advance: new Intl.NumberFormat(locale).format(osvcMinSocialAdvance(params.year, params.minSocialShareFrom.fromMonth))
              })}
            </>
          ) : null}
        </p>
      </section>
    </div>
  );
}
