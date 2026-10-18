'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import {
  compareFlatTaxRegimes,
  flatTaxMonthly,
  OSVC_FLAT_EXPENSE_CAPS,
  type FlatTaxBand,
  type OsvcFlatRate,
  type RegimeOption
} from '@faktur/cz-compliance';
import { AmountField, money, parseAmount, ResultRow, SelectField } from '@/components/public-tools/fields';
import { cn } from '@/lib/utils';

const RATES = [80, 60, 40, 30] as const satisfies readonly OsvcFlatRate[];
const CHILDREN = ['0', '1', '2', '3', '4', '5'] as const;

/** Numbers the in-app page fills in from the company's own invoices, expenses and settings. */
export interface FlatTaxPrefill {
  year: number;
  income: number;
  actualExpenses: number;
  vatPayer: boolean;
}

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

const typed = (n: number) => (n > 0 ? new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(Math.round(n)) : '');

/**
 * "Vyplatí se paušální daň?": the paušální daň band against the regular
 * regime with the výdajový paušál and with actual expenses. All the maths is
 * compareFlatTaxRegimes in @faktur/cz-compliance; this only collects the
 * inputs and shows the three options side by side. The same component runs
 * on the public page and, prefilled, inside the dashboard.
 */
export function FlatTaxCalculator({ years, prefill }: { years: number[]; prefill?: FlatTaxPrefill }) {
  const t = useTranslations('tools.calculators.items.flatTax');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const format = useFormatter();
  const startYear = prefill && years.includes(prefill.year) ? prefill.year : (years[years.length - 1] ?? new Date().getFullYear());
  const [year, setYear] = useState(String(startYear));
  const [income, setIncome] = useState(prefill ? typed(prefill.income) : '800 000');
  const [expenses, setExpenses] = useState(prefill ? typed(prefill.actualExpenses) : '');
  const [flatRate, setFlatRate] = useState<string>('60');
  const [children, setChildren] = useState<string>('0');
  const [spouse, setSpouse] = useState(false);
  const [vatPayer, setVatPayer] = useState(prefill?.vatPayer ?? false);

  const y = Number(year);
  const rate = Number(flatRate) as OsvcFlatRate;
  const actual = parseAmount(expenses);
  const r = useMemo(
    () => compareFlatTaxRegimes({ year: y, income: parseAmount(income), actualExpenses: actual, flatRate: rate, vatPayer, spouse, children: Number(children) }),
    [y, income, actual, rate, vatPayer, spouse, children]
  );
  const czk = (n: number) => money(locale, n);
  const monthName = (m: number) => format.dateTime(new Date(Date.UTC(y, m - 1, 15)), { month: 'long', year: 'numeric', timeZone: 'Europe/Prague' });

  if (!r) return <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{t('unavailable.no_data')}</p>;

  const flat = r.options.find((o) => o.kind === 'flat_tax')!;
  // Without typed actual expenses that column would only repeat "worse than the paušál".
  const shown = r.options.filter((o) => o.kind !== 'actual_expenses' || actual > 0);
  const runs = flat.available && flat.band != null ? monthlyRuns(y, flat.band) : [];
  // A retroactive cut (2026 band 1) settles at the new amount for the whole year.
  const paidMore = runs.length > 1 && runs.reduce((s, run, i) => s + run.amount * ((runs[i + 1]?.fromMonth ?? 13) - run.fromMonth), 0) !== flat.total;
  const label = (o: RegimeOption) => t(`options.${o.kind}`, { rate });

  let verdict: string;
  if (r.saving === 0) verdict = t('recommend.same');
  else if (!flat.available) verdict = actual > 0 ? t(`recommend.noFlat.${r.best === 'actual_expenses' ? 'actual_expenses' : 'flat_expenses'}`, { amount: czk(r.saving) }) : t('recommend.noFlatOnly');
  else verdict = t(`recommend.${r.best}`, { amount: czk(r.saving) });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <SelectField label={t('fields.year')} value={year} onChange={setYear} options={years.map((v) => ({ value: String(v), label: String(v) }))} />
        <AmountField label={t('fields.income')} value={income} onChange={setIncome} />
        <AmountField label={t('fields.actualExpenses')} value={expenses} onChange={setExpenses} hint={t('fields.actualHint')} />
        <SelectField
          label={t('fields.flatRate')}
          value={flatRate}
          onChange={setFlatRate}
          options={RATES.map((v) => ({ value: String(v), label: t(`rates.${v}`, { cap: new Intl.NumberFormat(locale).format(OSVC_FLAT_EXPENSE_CAPS[v]) }) }))}
        />
        <SelectField label={t('fields.children')} value={children} onChange={(v) => setChildren(v)} options={CHILDREN.map((v) => ({ value: v, label: v }))} />
        <Toggle label={t('fields.spouse')} checked={spouse} onChange={setSpouse} />
        <Toggle label={t('fields.vatPayer')} checked={vatPayer} onChange={setVatPayer} />
      </form>

      <section aria-live="polite" className="min-w-0 rounded-xl border border-border bg-card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {tc('resultTitle')} · {y}
        </h2>
        <p className="mt-3 rounded-lg bg-primary/10 p-3 text-sm font-semibold text-primary">{verdict}</p>

        <div className={cn('mt-4 grid gap-3', shown.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {shown.map((o) => (
            <div key={o.kind} className={cn('rounded-lg border p-3 text-sm', o.kind === r.best ? 'border-primary ring-1 ring-primary' : 'border-border')}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{label(o)}</h3>
                {o.kind === r.best && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {t('result.best')}
                  </span>
                )}
              </div>
              {o.total == null ? (
                <p className="mt-2 text-muted-foreground">{t(`unavailable.${o.reason ?? 'no_data'}`)}</p>
              ) : (
                <dl className="mt-1">
                  {o.kind === 'flat_tax' ? (
                    <>
                      <ResultRow label={t('result.band')} value={t('result.bandValue', { band: o.band ?? 0 })} />
                      <p className="pb-1 text-xs text-muted-foreground">{t('result.oneSum')}</p>
                    </>
                  ) : (
                    <>
                      <ResultRow label={t('result.expenses')} value={czk(o.expenses ?? 0)} />
                      <ResultRow label={t('result.tax')} value={czk(o.tax ?? 0)} />
                      <ResultRow label={t('result.social')} value={czk(o.social ?? 0)} />
                      <ResultRow label={t('result.health')} value={czk(o.health ?? 0)} />
                      {o.bonus > 0 && <ResultRow label={t('result.bonus')} value={`−${czk(o.bonus)}`} />}
                    </>
                  )}
                  <ResultRow label={t('result.total')} value={czk(o.total)} strong />
                </dl>
              )}
            </div>
          ))}
        </div>

        {runs.length > 0 && (
          <div className="mt-4 rounded-lg bg-secondary/60 p-3 text-sm">
            <p className="font-semibold">{t('monthlyTitle', { band: flat.band ?? 0 })}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {runs.map((run) => (
                <li key={run.fromMonth}>{t('monthlyFrom', { date: monthName(run.fromMonth), amount: czk(run.amount) })}</li>
              ))}
            </ul>
            {paidMore && <p className="mt-2 text-xs text-muted-foreground">{t('retroactiveNote')}</p>}
          </div>
        )}
        {(spouse || Number(children) > 0) && flat.available && <p className="mt-4 text-xs text-muted-foreground">{t('creditsNote')}</p>}
        <p className="mt-2 text-xs text-muted-foreground">{t('compareNote')}</p>
      </section>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
      <span>{label}</span>
    </label>
  );
}
