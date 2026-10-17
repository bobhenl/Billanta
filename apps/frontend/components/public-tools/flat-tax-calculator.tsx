'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import {
  computeOsvcAnnualSummary,
  fitsFlatTaxBand1,
  flatTaxBand1ForYear,
  minimumPeriods,
  OSVC_FLAT_EXPENSE_CAPS,
  type OsvcFlatRate
} from '@faktur/cz-compliance';
import { AmountField, money, parseAmount, ResultRow, SelectField } from '@/components/public-tools/fields';

const RATES = [80, 60, 40, 30] as const satisfies readonly OsvcFlatRate[];

/**
 * Paušální daň, band 1, against the regular regime with flat-rate expenses.
 * Both sides come from @faktur/cz-compliance: the monthly band-1 amounts
 * from the minimums table (which carries the mid-year change), the regular
 * regime from computeOsvcAnnualSummary. Higher bands are not computed;
 * the page says so instead of guessing.
 */
export function FlatTaxCalculator({ years }: { years: number[] }) {
  const t = useTranslations('tools.calculators.items.flatTax');
  const tOsvc = useTranslations('tools.calculators.items.osvc');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const format = useFormatter();
  const [year, setYear] = useState(String(years[years.length - 1] ?? new Date().getFullYear()));
  const [income, setIncome] = useState('800 000');
  const [flatRate, setFlatRate] = useState<string>('60');

  const y = Number(year);
  const rate = Number(flatRate) as OsvcFlatRate;
  const amount = parseAmount(income);
  const band1 = flatTaxBand1ForYear(y);
  const periods = useMemo(() => minimumPeriods('CZ', y).filter((p) => p.values.flat_tax != null), [y]);
  const fits = fitsFlatTaxBand1(amount, rate);
  const normal = useMemo(() => computeOsvcAnnualSummary({ year: y, income: amount, actualExpenses: 0, flatRate: rate }), [y, amount, rate]);
  const czk = (n: number) => money(locale, n);
  const diff = band1 == null ? 0 : normal.totalBurden - band1;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <SelectField label={t('fields.year')} value={year} onChange={setYear} options={years.map((v) => ({ value: String(v), label: String(v) }))} />
        <AmountField label={t('fields.income')} value={income} onChange={setIncome} />
        <SelectField
          label={t('fields.flatRate')}
          value={flatRate}
          onChange={setFlatRate}
          options={RATES.map((r) => ({ value: String(r), label: tOsvc(`rates.${r}`, { cap: new Intl.NumberFormat(locale).format(OSVC_FLAT_EXPENSE_CAPS[r]) }) }))}
        />
        {periods.length > 0 && (
          <div className="rounded-lg bg-secondary/60 p-3 text-sm">
            <p className="font-semibold">{t('monthlyTitle')}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {periods.map((p) => (
                <li key={p.from}>
                  {t('monthlyFrom', {
                    date: format.dateTime(new Date(`${p.from}-01T12:00:00Z`), { month: 'long', year: 'numeric', timeZone: 'Europe/Prague' }),
                    amount: czk(p.values.flat_tax!)
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>

      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {tc('resultTitle')} · {y}
        </h2>
        {band1 == null ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('noData')}</p>
        ) : !fits ? (
          <>
            <p className="mt-3 text-sm">{t('notBand1')}</p>
            <dl className="mt-3 text-sm">
              <ResultRow label={t('normalTotal')} value={czk(normal.totalBurden)} />
            </dl>
          </>
        ) : (
          <>
            <dl className="mt-3 text-sm">
              <ResultRow label={t('yearTotal')} value={czk(band1)} />
              <ResultRow label={t('normalTotal')} value={czk(normal.totalBurden)} />
              <ResultRow label={tOsvc('result.tax')} value={czk(normal.tax.total)} />
              <ResultRow label={tOsvc('result.social')} value={czk(normal.social.total)} />
              <ResultRow label={tOsvc('result.health')} value={czk(normal.health.total)} />
            </dl>
            <p className="mt-4 rounded-lg bg-primary/10 p-3 text-sm font-semibold text-primary">
              {diff >= 0 ? t('cheaper', { amount: czk(diff) }) : t('dearer', { amount: czk(-diff) })}
            </p>
          </>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{t('compareNote')}</p>
      </section>
    </div>
  );
}
