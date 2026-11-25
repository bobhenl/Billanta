'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Shares, TaxPartner } from '@/lib/net-income';
import { inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** The one partner a split gives everything to, or null. */
function soleOf(value: Shares | null, partners: TaxPartner[]): string | null {
  if (!value) return null;
  const ids = Object.entries(value).filter(([id, w]) => w > 0 && partners.some((p) => p.id === id));
  return ids.length === 1 ? ids[0]![0] : null;
}

/**
 * Who a piece of income or an expense belongs to: the default shares, one
 * partner alone, or own weights (1 : 1, 1 : 2 …). Weights are applied with
 * the check button, so typing does not save half a split.
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
  const sole = soleOf(value, partners);
  const [custom, setCustom] = useState(value != null && sole == null);
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(partners.map((p) => [p.id, String(value?.[p.id] ?? (value ? 0 : p.share))]))
  );
  const selected = custom ? 'custom' : (sole ?? '');
  const parsed = Object.fromEntries(Object.entries(weights).map(([id, w]) => [id, Math.max(0, Number(w.replace(',', '.')) || 0)]));
  const valid = Object.values(parsed).some((w) => w > 0);

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <select
        aria-label={label}
        className={cn(inputClass, 'h-9 w-auto max-w-[12rem] py-1')}
        value={selected}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom') {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(v ? { [v]: 1 } : null);
        }}
      >
        <option value="">{t('default')}</option>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>
            {t('alone', { name: p.name })}
          </option>
        ))}
        <option value="custom">{t('custom')}</option>
      </select>
      {custom && (
        <>
          {partners.map((p) => (
            <label key={p.id} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="max-w-[5rem] truncate">{p.name}</span>
              <input
                inputMode="decimal"
                className={cn(inputClass, 'h-9 w-14 px-2 py-1 text-right tabular-nums')}
                value={weights[p.id] ?? ''}
                disabled={disabled}
                onChange={(e) => setWeights((w) => ({ ...w, [p.id]: e.target.value }))}
              />
            </label>
          ))}
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-primary hover:bg-accent disabled:opacity-50"
            disabled={disabled || !valid}
            aria-label={t('apply')}
            title={t('apply')}
            onClick={() => onChange(Object.fromEntries(Object.entries(parsed).filter(([, w]) => w > 0)))}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}
    </span>
  );
}
