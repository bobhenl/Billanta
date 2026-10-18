'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  addMonths,
  applicableMinimums,
  currentAdvancePeriod,
  isMonthKey,
  monthKey,
  normalizeTaxAdvances,
  TAX_ADVANCE_KINDS,
  TAX_ADVANCE_MAX,
  type ActivityKind,
  type AdvanceRegime,
  type TaxAdvanceKind,
  type TaxAdvancePeriod
} from '@faktur/cz-compliance';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { formatMoney } from '@/lib/invoice-ui';
import { cn } from '@/lib/utils';

/** One row as edited: amounts are strings, '' = not set in this period (the earlier amount applies). */
export interface AdvanceRow {
  id: string;
  from: string;
  social: string;
  health: string;
  flat_tax: string;
}

let nextId = 0;
const rowId = () => `row-${++nextId}`;

export function rowsFromAdvances(raw: unknown): AdvanceRow[] {
  return normalizeTaxAdvances(raw).map((p) => ({
    id: rowId(),
    from: p.from,
    social: p.social == null ? '' : String(p.social),
    health: p.health == null ? '' : String(p.health),
    flat_tax: p.flat_tax == null ? '' : String(p.flat_tax)
  }));
}

const parseAmount = (raw: string): number | null | 'invalid' => {
  const s = raw.replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= TAX_ADVANCE_MAX ? n : 'invalid';
};

/**
 * The rows as the backend wants them, or the first problem: a bad or
 * duplicate month, or an amount that is not a number.
 */
export function advancesPayload(rows: AdvanceRow[]): { ok: true; value: Array<Record<string, string | number | null>> } | { ok: false; error: 'month' | 'duplicate' | 'amount' } {
  const seen = new Set<string>();
  const value: Array<Record<string, string | number | null>> = [];
  for (const row of rows) {
    if (!isMonthKey(row.from)) return { ok: false, error: 'month' };
    if (seen.has(row.from)) return { ok: false, error: 'duplicate' };
    seen.add(row.from);
    const entry: Record<string, string | number | null> = { from: row.from };
    for (const k of TAX_ADVANCE_KINDS) {
      const n = parseAmount(row[k]);
      if (n === 'invalid') return { ok: false, error: 'amount' };
      entry[k] = n;
    }
    value.push(entry);
  }
  return { ok: true, value };
}

/** Stable comparison for the form's "unsaved changes" count. */
export const rowsKey = (rows: AdvanceRow[]) =>
  JSON.stringify(
    [...rows].sort((a, b) => a.from.localeCompare(b.from)).map((r) => [r.from, r.social.trim(), r.health.trim(), r.flat_tax.trim()])
  );

const asPeriods = (rows: AdvanceRow[]): TaxAdvancePeriod[] =>
  rows.filter((r) => isMonthKey(r.from)).map((r) => {
    const p: TaxAdvancePeriod = { from: r.from };
    for (const k of TAX_ADVANCE_KINDS) {
      const n = parseAmount(r[k]);
      if (typeof n === 'number') p[k] = n;
    }
    return p;
  });

/** Paušální režim and hlavní / vedlejší činnost as edited in the form: '' = not answered. */
export interface RegimeAnswers {
  flatTax: '' | 'yes' | 'no';
  activity: '' | ActivityKind;
}

export const regimeOf = (a: RegimeAnswers): AdvanceRegime => ({
  flatTax: a.flatTax === '' ? null : a.flatTax === 'yes',
  activity: a.activity === '' ? null : a.activity
});

/** A small yes / no style choice; used for the two questions and inline next to the minimum. */
function Choice<V extends string>({
  name,
  value,
  options,
  onPick,
  disabled
}: {
  name: string;
  value: V | '';
  options: { value: V; label: string }[];
  onPick: (value: V) => void;
  disabled: boolean;
}) {
  return (
    <span role="radiogroup" aria-label={name} className="inline-flex shrink-0 overflow-hidden rounded-full border border-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onPick(o.value)}
          className={cn(
            'px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60',
            value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * Settings → Měsíční zálohy: amounts by period. Each row applies from its
 * month on; an empty field keeps the amount of the row before. Newest first,
 * the one in force this month highlighted. A Czech OSVČ answers two questions
 * first (paušální režim, hlavní / vedlejší činnost): they decide which
 * statutory minimums "Použít" fills.
 */
export function TaxAdvancesEditor({
  rows,
  onChange,
  country,
  readOnly,
  answers,
  onAnswers
}: {
  rows: AdvanceRow[];
  onChange: (rows: AdvanceRow[]) => void;
  country: string;
  readOnly: boolean;
  answers: RegimeAnswers;
  onAnswers: (patch: Partial<RegimeAnswers>) => void;
}) {
  const t = useTranslations('settings.company.advances');
  const locale = useLocale();
  const sk = country.toUpperCase() === 'SK';
  const kinds: TaxAdvanceKind[] = TAX_ADVANCE_KINDS.filter((k) => k !== 'flat_tax' || !sk);
  const currency = sk ? 'EUR' : 'CZK';
  const regime = regimeOf(answers);
  const thisMonth = monthKey(new Date());
  const current = currentAdvancePeriod(asPeriods(rows), thisMonth)?.from ?? null;
  const sorted = [...rows].sort((a, b) => b.from.localeCompare(a.from));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.from, (counts.get(r.from) ?? 0) + 1);

  const update = (id: string, patch: Partial<AdvanceRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = () => {
    // Next month by default; if that one is taken, the first free month after it.
    let from = addMonths(thisMonth, 1);
    while (rows.some((r) => r.from === from)) from = addMonths(from, 1);
    onChange([...rows, { id: rowId(), from, social: '', health: '', flat_tax: '' }]);
  };
  const monthLabel = (m: string) => `${Number(m.slice(5))}/${m.slice(0, 4)}`;
  // The label follows the answer, so it stays one line; the full wording is the tooltip.
  const label = (k: TaxAdvanceKind) =>
    k !== 'flat_tax' || sk ? t(k) : t(`flatTaxLabel.${regime.flatTax == null ? 'unknown' : regime.flatTax ? 'flat' : 'advance'}`);
  const yesNo = [
    { value: 'yes' as const, label: t('regime.yes') },
    { value: 'no' as const, label: t('regime.no') }
  ];
  const activities = [
    { value: 'main' as const, label: t('regime.main') },
    { value: 'secondary' as const, label: t('regime.secondary') }
  ];
  const grid = sk ? 'sm:grid-cols-[10rem_repeat(2,minmax(0,1fr))_auto]' : 'sm:grid-cols-[10rem_repeat(3,minmax(0,1fr))_auto]';

  return (
    <div className="space-y-2">
      {!sk && (
        <div className="mb-3 space-y-2 rounded-lg bg-secondary/60 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <InfoHint hint={t('regime.flatTaxHint')}>
              <span className="font-medium">{t('regime.flatTax')}</span>
            </InfoHint>
            <Choice name={t('regime.flatTax')} value={answers.flatTax} options={yesNo} disabled={readOnly} onPick={(v) => onAnswers({ flatTax: v })} />
          </div>
          {answers.flatTax !== 'yes' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <InfoHint hint={t('regime.activityHint')}>
                <span className="font-medium">{t('regime.activity')}</span>
              </InfoHint>
              <Choice name={t('regime.activity')} value={answers.activity} options={activities} disabled={readOnly} onPick={(v) => onAnswers({ activity: v })} />
            </div>
          )}
        </div>
      )}
      {sorted.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {sorted.map((row) => {
        const isCurrent = row.from === current;
        const duplicate = (counts.get(row.from) ?? 0) > 1;
        const found = isMonthKey(row.from) ? applicableMinimums(sk ? 'SK' : 'CZ', row.from, regime) : null;
        const ask = found && 'ask' in found ? found.ask : null;
        const minimums = found && 'values' in found ? found : null;
        const minimumKinds = kinds.filter((k) => minimums?.values[k] != null);
        // "Použít" fills the minimums that apply and puts 0 into the other empty fields,
        // so an amount from an older row (social before paušál, say) does not carry on.
        const applyMinimum = () =>
          minimums &&
          update(
            row.id,
            Object.fromEntries(
              kinds.flatMap((k) => (minimums.values[k] != null ? [[k, String(minimums.values[k])]] : row[k].trim() === '' ? [[k, '0']] : []))
            )
          );
        return (
          <div key={row.id} className={cn('rounded-lg border p-3', isCurrent ? 'border-primary bg-primary/5' : 'border-border')}>
            {/* Phone: month + trash on one line, amounts below. From sm: one row, every input on the same baseline. */}
            <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-3 sm:gap-x-3', grid)}>
              <label className={cn('block min-w-0 text-sm', readOnly && 'col-span-2 sm:col-span-1')}>
                <span className="mb-1 flex h-5 items-center gap-2 font-medium">
                  <span className="truncate">{t('from')}</span>
                  {isCurrent && <span className="shrink-0 rounded bg-primary px-1.5 text-[10px] font-bold uppercase leading-4 text-primary-foreground">{t('current')}</span>}
                </span>
                <input
                  type="month"
                  className={cn(inputClass, duplicate && 'border-destructive')}
                  value={row.from}
                  disabled={readOnly}
                  required
                  aria-invalid={duplicate || undefined}
                  onChange={(e) => update(row.id, { from: e.target.value })}
                />
              </label>
              {kinds.map((k) => (
                <label key={k} className="col-span-2 block min-w-0 text-sm sm:col-span-1">
                  <span className="mb-1 block h-5 truncate font-medium" title={t(k)}>
                    {label(k)}
                  </span>
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    placeholder={t('inherit')}
                    aria-label={t(k)}
                    value={row[k]}
                    disabled={readOnly}
                    onChange={(e) => update(row.id, { [k]: e.target.value })}
                  />
                </label>
              ))}
              {!readOnly && (
                <div className="col-start-2 row-start-1 flex items-end sm:order-last sm:col-start-auto sm:row-start-auto">
                  <button
                    type="button"
                    className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                    aria-label={t('remove', { month: monthLabel(row.from) })}
                    title={t('remove', { month: monthLabel(row.from) })}
                    onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            {duplicate && <p className="mt-2 text-xs text-destructive">{t('duplicate')}</p>}
            {!readOnly && ask && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t(ask === 'flat_tax' ? 'minimumAsk.flatTax' : 'minimumAsk.activity')}</span>
                {ask === 'flat_tax' ? (
                  <Choice name={t('regime.flatTax')} value={answers.flatTax} options={yesNo} disabled={readOnly} onPick={(v) => onAnswers({ flatTax: v })} />
                ) : (
                  <Choice name={t('regime.activity')} value={answers.activity} options={activities} disabled={readOnly} onPick={(v) => onAnswers({ activity: v })} />
                )}
              </p>
            )}
            {!readOnly && minimums && minimumKinds.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('minimum', {
                  from: monthLabel(minimums.from),
                  amounts: minimumKinds.map((k) => `${t(`short.${k}`)} ${formatMoney(minimums.values[k]!, currency, locale)}`).join(', ')
                })}{' '}
                <button type="button" className="font-semibold text-primary hover:underline" title={t('useMinimumHint')} onClick={applyMinimum}>
                  {t('useMinimum')}
                </button>
              </p>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <button type="button" className={buttonClass.secondary} onClick={add}>
          <Plus className="h-4 w-4" />
          {t('add')}
        </button>
      )}
    </div>
  );
}
