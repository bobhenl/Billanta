'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import {
  computeOsvcAnnualSummary,
  flatTaxBandFor,
  flatTaxMonthly,
  flatTaxYearTotal,
  OSVC_FLAT_EXPENSE_CAPS,
  type FlatTaxBand,
  type OsvcFlatRate
} from '@faktur/cz-compliance';
import { AmountField, money, parseAmount, ResultRow, SelectField } from '@/components/public-tools/fields';

const RATES = [80, 60, 40, 30] as const satisfies readonly OsvcFlatRate[];

/** Monthly amounts of a band through the year, merged into runs ("from July: …"). */
function monthlyRuns(year: number, band: FlatTaxBand): { fromMonth: number; amount: number }[] {
  const runs: { fromMonth: number; amount: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const amount = flatTaxMonthly(year, band, m);
    if (amount == null) return [];
    if (runs[runs.length - 1]?.amount !== amount) runs.push({ fromMonth: m, amount });
  }
  return runs;
}

/**
 * Paušální daň in the band the income fits, against the regular regime with
 * flat-rate expenses. Both sides come from @faktur/cz-compliance: the band
 * amounts from cz-tax-years (which carries the 2026 mid-year change), the
 * regular regime from computeOsvcAnnualSummary.
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
  const band = flatTaxBandFor(amount, rate);
  const total = band == null ? null : flatTaxYearTotal(y, band);
  const runs = useMemo(() => (band == null ? [] : monthlyRuns(y, band)), [y, band]);
  const normal = useMemo(() => computeOsvcAnnualSummary({ year: y, income: amount, actualExpenses: 0, flatRate: rate }), [y, amount, rate]);
  const czk = (n: number) => money(locale, n);
  const diff = total == null ? 0 : normal.totalBurden - total;
  // A retroactive cut (2026 band 1) settles at the new amount for the whole year.
  const paidMore = band != null && total != null && runs.length > 1 && runs.reduce((s, r, i) => s + r.amount * ((runs[i + 1]?.fromMonth ?? 13) - r.fromMonth), 0) !== total;
  const monthName = (m: number) => format.dateTime(new Date(Date.UTC(y, m - 1, 15)), { month: 'long', year: 'numeric', timeZone: 'Europe/Prague' });

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
        {band != null && runs.length > 0 && (
          <div className="rounded-lg bg-secondary/60 p-3 text-sm">
            <p className="font-semibold">{t('monthlyTitle', { band })}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {runs.map((r) => (
                <li key={r.fromMonth}>{t('monthlyFrom', { date: monthName(r.fromMonth), amount: czk(r.amount) })}</li>
              ))}
            </ul>
            {paidMore && <p className="mt-2 text-xs text-muted-foreground">{t('retroactiveNote')}</p>}
          </div>
        )}
      </form>

      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {tc('resultTitle')} · {y}
        </h2>
        {band == null ? (
          <>
            <p className="mt-3 text-sm">{t('notEligible')}</p>
            <dl className="mt-3 text-sm">
              <ResultRow label={t('normalTotal')} value={czk(normal.totalBurden)} />
            </dl>
          </>
        ) : total == null ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('noData')}</p>
        ) : (
          <>
            <p className="mt-3 text-sm font-semibold">{t('bandFits', { band })}</p>
            <dl className="mt-3 text-sm">
              <ResultRow label={t('yearTotal')} value={czk(total)} />
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
