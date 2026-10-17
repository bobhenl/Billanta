'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { addMonths, currentAdvancePeriod, isMonthKey, monthKey, normalizeTaxAdvances, TAX_ADVANCE_KINDS, TAX_ADVANCE_MAX, type TaxAdvanceKind, type TaxAdvancePeriod } from '@faktur/cz-compliance';
import { buttonClass, inputClass } from '@/components/modal';
import { formatMoney } from '@/lib/invoice-ui';
import { minimumsAt } from '@/lib/tax-minimums';
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

/**
 * Settings → Měsíční zálohy: amounts by period. Each row applies from its
 * month on; an empty field keeps the amount of the row before. Newest first,
 * the one in force this month highlighted.
 */
export function TaxAdvancesEditor({
  rows,
  onChange,
  country,
  readOnly
}: {
  rows: AdvanceRow[];
  onChange: (rows: AdvanceRow[]) => void;
  country: string;
  readOnly: boolean;
}) {
  const t = useTranslations('settings.company.advances');
  const locale = useLocale();
  const sk = country.toUpperCase() === 'SK';
  const kinds: TaxAdvanceKind[] = TAX_ADVANCE_KINDS.filter((k) => k !== 'flat_tax' || !sk);
  const currency = sk ? 'EUR' : 'CZK';
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

  return (
    <div className="space-y-2">
      {sorted.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {sorted.map((row) => {
        const isCurrent = row.from === current;
        const duplicate = (counts.get(row.from) ?? 0) > 1;
        const minimums = isMonthKey(row.from) ? minimumsAt(country, row.from) : null;
        const minimumKinds = kinds.filter((k) => minimums?.values[k] != null);
        return (
          <div key={row.id} className={cn('rounded-lg border p-3', isCurrent ? 'border-primary bg-primary/5' : 'border-border')}>
            <div className={cn('grid gap-3', sk ? 'sm:grid-cols-[10rem_1fr_1fr_auto]' : 'sm:grid-cols-[10rem_1fr_1fr_1fr_auto]')}>
              <label className="block text-sm">
                <span className="mb-1 flex items-center gap-2 font-medium">
                  {t('from')}
                  {isCurrent && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">{t('current')}</span>}
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
                <label key={k} className="block text-sm">
                  <span className="mb-1 block font-medium">{t(k)}</span>
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    placeholder={t('inherit')}
                    value={row[k]}
                    disabled={readOnly}
                    onChange={(e) => update(row.id, { [k]: e.target.value })}
                  />
                </label>
              ))}
              {!readOnly && (
                <div className="flex items-end">
                  <button
                    type="button"
                    className={cn(buttonClass.ghost, 'text-muted-foreground hover:text-destructive')}
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
            {!readOnly && minimums && minimumKinds.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('minimum', {
                  from: monthLabel(minimums.from),
                  amounts: minimumKinds.map((k) => `${t(`short.${k}`)} ${formatMoney(minimums.values[k]!, currency, locale)}`).join(', ')
                })}{' '}
                <button
                  type="button"
                  className="font-semibold text-primary hover:underline"
                  onClick={() => update(row.id, Object.fromEntries(minimumKinds.map((k) => [k, String(minimums.values[k])])))}
                >
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
