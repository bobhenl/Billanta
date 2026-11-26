'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Shares, TaxPartner } from '@/lib/net-income';
import { inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** Short tags for the partners: the first letter, or more letters while two would look the same. */
export function partnerTags(partners: Pick<TaxPartner, 'id' | 'name'>[]): Record<string, string> {
  const names = partners.map((p) => (p.name || p.id).trim());
  const out: Record<string, string> = {};
  partners.forEach((p, i) => {
    // A name that already is an abbreviation ("HS") stays whole.
    if (/^[A-Z0-9]{2,3}$/.test(names[i]!)) {
      out[p.id] = names[i]!;
      return;
    }
    let n = 1;
    while (n < names[i]!.length && names.some((o, j) => j !== i && o.slice(0, n).toUpperCase() === names[i]!.slice(0, n).toUpperCase())) n++;
    out[p.id] = names[i]!.slice(0, n).toUpperCase();
  });
  return out;
}

/** Full class strings, so Tailwind keeps them. `soft` is the dimmed look of the default shares. */
const PARTNER_COLORS = [
  { solid: 'bg-indigo-600 text-white', soft: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
  { solid: 'bg-emerald-600 text-white', soft: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  { solid: 'bg-amber-600 text-white', soft: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  { solid: 'bg-rose-600 text-white', soft: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  { solid: 'bg-sky-600 text-white', soft: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { solid: 'bg-violet-600 text-white', soft: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  { solid: 'bg-teal-600 text-white', soft: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
  { solid: 'bg-orange-600 text-white', soft: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' }
] as const;

export type PartnerColor = (typeof PARTNER_COLORS)[number];

/** One colour per partner, by their order in the model, so M is the same colour on every page. */
export function partnerColors(partners: Pick<TaxPartner, 'id'>[]): Record<string, PartnerColor> {
  return Object.fromEntries(partners.map((p, i) => [p.id, PARTNER_COLORS[i % PARTNER_COLORS.length]!]));
}

/** Partners with a positive weight; the defaults when nothing is set. */
function activeOf(value: Shares | null, partners: TaxPartner[]): Set<string> {
  const src = value ?? Object.fromEntries(partners.map((p) => [p.id, p.share]));
  return new Set(partners.filter((p) => (src[p.id] ?? 0) > 0).map((p) => p.id));
}

/** Whether the weights differ, so plain tags would hide the ratio. */
function unequal(value: Shares | null, partners: TaxPartner[]): boolean {
  if (!value) return false;
  const w = partners.map((p) => value[p.id] ?? 0).filter((x) => x > 0);
  return w.some((x) => Math.abs(x - w[0]!) > 1e-9);
}

/**
 * Who a piece of income or an expense belongs to, as one small tag per
 * partner (M, R, D…): a click adds or removes that partner and the active
 * ones share equally. "1:2" opens own weights, applied with the check button
 * so typing does not save half a split. Dimmed tags = the default shares.
 */
export function SharesPicker({
  partners,
  value,
  onChange,
  disabled,
  label
}: {
  partners: TaxPartner[];
  value: Shares | null;
  onChange: (shares: Shares | null) => void;
  disabled?: boolean;
  label: string;
}) {
  const t = useTranslations('netIncome.shares');
  const tags = partnerTags(partners);
  const colors = partnerColors(partners);
  const active = activeOf(value, partners);
  const ratio = unequal(value, partners);
  const [custom, setCustom] = useState(false);
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(partners.map((p) => [p.id, String(value?.[p.id] ?? (value ? 0 : p.share))]))
  );
  const parsed = Object.fromEntries(Object.entries(weights).map(([id, w]) => [id, Math.max(0, Number(w.replace(',', '.')) || 0)]));
  const valid = Object.values(parsed).some((w) => w > 0);

  const toggle = (id: string) => {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Removing the last one goes back to the default shares.
    onChange(next.size ? Object.fromEntries([...next].map((p) => [p, 1])) : null);
  };

  return (
    <span role="group" aria-label={label} className="flex min-w-0 flex-wrap items-center gap-1">
      {partners.map((p) => {
        const on = active.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            title={`${p.name}${ratio && on ? ` · ${value?.[p.id]}` : ''}`}
            disabled={disabled}
            onClick={() => toggle(p.id)}
            className={cn(
              'h-6 min-w-6 rounded-md px-1.5 text-[11px] font-bold transition-colors disabled:opacity-50',
              on
                ? value
                  ? colors[p.id]!.solid
                  : colors[p.id]!.soft
                : 'border border-border text-muted-foreground hover:bg-accent'
            )}
          >
            {tags[p.id]}
          </button>
        );
      })}
      <button
        type="button"
        aria-expanded={custom}
        title={t('custom')}
        disabled={disabled}
        onClick={() => setCustom((c) => !c)}
        className={cn(
          'h-6 rounded-md px-1.5 text-[11px] font-semibold tabular-nums hover:bg-accent disabled:opacity-50',
          ratio ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        1:2
      </button>
      {custom && (
        <>
          {partners.map((p) => (
            <label key={p.id} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span title={p.name}>{tags[p.id]}</span>
              <input
                inputMode="decimal"
                className={cn(inputClass, 'h-8 w-16 px-2 py-1 text-right tabular-nums')}
                value={weights[p.id] ?? ''}
                disabled={disabled}
                onChange={(e) => setWeights((w) => ({ ...w, [p.id]: e.target.value }))}
              />
            </label>
          ))}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-primary hover:bg-accent disabled:opacity-50"
            disabled={disabled || !valid}
            aria-label={t('apply')}
            title={t('apply')}
            onClick={() => {
              onChange(Object.fromEntries(Object.entries(parsed).filter(([, w]) => w > 0)));
              setCustom(false);
            }}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}
    </span>
  );
}
