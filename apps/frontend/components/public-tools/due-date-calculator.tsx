'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { isWeekend, nextWorkingDay, publicHolidayOn, type HolidayCountry } from '@faktur/cz-compliance';
import { ResultRow, Segmented, SelectField, TextField } from '@/components/public-tools/fields';

const TERMS = ['7', '10', '14', '15', '21', '30', '45', '60', '90'];

/** "2026-10-18" ↔ local Date, because the holiday helpers work in local time. */
const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fromInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/**
 * Issue date + term in calendar days, then a check of the resulting day.
 * Whether a due date on a weekend moves depends on how the contract words it,
 * so the calculator keeps the computed date and only suggests the next
 * working day; it makes no legal claim either way.
 */
export function DueDateCalculator({ defaultCountry }: { defaultCountry: HolidayCountry }) {
  const t = useTranslations('tools.calculators.items.dueDate');
  const th = useTranslations('holidays');
  const format = useFormatter();
  const [country, setCountry] = useState<HolidayCountry>(defaultCountry);
  const [issued, setIssued] = useState('');
  // Today is filled in after mount: the server's "today" can differ from the visitor's.
  useEffect(() => setIssued((v) => v || toInput(new Date())), []);
  const [term, setTerm] = useState('14');

  const start = fromInput(issued);
  const due = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + Number(term)) : null;
  const holiday = due ? publicHolidayOn(due, country) : null;
  const weekend = due ? isWeekend(due) : false;
  const next = due && (holiday || weekend) ? nextWorkingDay(due, country) : null;
  const long = (d: Date) => format.dateTime(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <Segmented
          label={t('fields.country')}
          value={country}
          onChange={setCountry}
          options={(['CZ', 'SK'] as const).map((c) => ({ value: c, label: t(`countries.${c}`) }))}
        />
        <TextField label={t('fields.issued')} type="date" value={issued} onChange={setIssued} />
        <SelectField label={t('fields.term')} value={term} onChange={setTerm} options={TERMS.map((d) => ({ value: d, label: t('fields.days', { n: Number(d) }) }))} />
      </form>
      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        {due ? (
          <>
            <dl className="text-sm">
              <ResultRow label={t('result.due')} value={long(due)} strong />
            </dl>
            {next ? (
              <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{holiday ? t('result.holiday', { name: th(holiday.key) }) : t('result.weekend')}</p>
                  <p className="mt-1 text-muted-foreground">{t('result.nextWorking', { date: long(next) })}</p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">{t('result.working')}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('result.empty')}</p>
        )}
      </section>
    </div>
  );
}
