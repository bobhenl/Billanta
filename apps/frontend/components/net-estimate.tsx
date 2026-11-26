'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { netAfterTaxes } from '@/lib/net-estimate';
import { cn } from '@/lib/utils';

/** Paušální výdaje an OSVČ can pick; 0 = no flat rate (all income is profit). */
const FLAT_RATES = [60, 80, 40, 30, 0] as const;
type FlatRate = (typeof FLAT_RATES)[number];
const STORAGE_KEY = 'billanta.netEstimate.flatRate';

/**
 * "Roughly how much of this invoice you keep" – base without VAT minus tax and insurance.
 * `fees` and `fxLoss` (what the actual payment lost to the provider and to the
 * conversion, in the invoice currency; a gain is negative) come off too, so it
 * agrees with the net proceeds. On a foreign-currency invoice `czkRate` adds the
 * amount in CZK, the currency the tax is paid in.
 */
export function NetEstimate({
  base,
  currency,
  czkRate,
  fees = 0,
  fxLoss = 0
}: {
  base: number;
  currency: string;
  czkRate?: number;
  fees?: number;
  fxLoss?: number;
}) {
  const t = useTranslations('netEstimate');
  const locale = useLocale();
  const [rate, setRate] = useState<FlatRate>(60);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if ((FLAT_RATES as readonly number[]).includes(saved) && localStorage.getItem(STORAGE_KEY) !== null) setRate(saved as FlatRate);
    } catch {
      /* storage blocked – keep the default */
    }
  }, []);
  const choose = (value: FlatRate) => {
    setRate(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* ignore */
    }
  };
  // Whole crowns are precise enough; 21 US$ hides up to half a dollar, so foreign currencies keep the cents.
  const digits = currency === 'CZK' ? 0 : 2;
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  const costs = fees + fxLoss;
  const { net, burden, tax, insurance } = netAfterTaxes(base, rate, costs);
  const czk = currency !== 'CZK' && czkRate && czkRate > 0 ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }) : null;
  const both = (amount: number) => (czk ? `${fmt.format(amount)} · ${czk.format(amount * czkRate!)}` : fmt.format(amount));
  // One scannable line per step; the fee and the conversion only when the payment had them.
  const lines: [string, string, boolean?][] = [
    [t('lines.withoutVat'), both(base)],
    ...(fees >= 0.005 ? [[`– ${t('lines.fee')}`, both(fees)] as [string, string]] : []),
    ...(Math.abs(fxLoss) >= 0.005 ? [[`${fxLoss > 0 ? '–' : '+'} ${t(fxLoss > 0 ? 'lines.fxLoss' : 'lines.fxGain')}`, both(Math.abs(fxLoss))] as [string, string]] : []),
    [`– ${t('lines.tax')}`, both(tax)],
    [`– ${t('lines.insurance')}`, both(insurance)],
    [`= ${t('label')}`, both(net), true]
  ];
  const hint = (
    <span className="block">
      <span className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
        {lines.map(([label, amount, total]) => (
          <span key={label} className={cn('contents', total && 'font-semibold text-foreground')}>
            <span className={cn(total && 'border-t border-border pt-0.5')}>{label}</span>
            <span className={cn('text-right', total && 'border-t border-border pt-0.5')}>{amount}</span>
          </span>
        ))}
      </span>
      {/* Marginal rates are the worst case for most: below the yearly limits this invoice costs no tax or insurance at all. */}
      {burden > 0 && <span className="mt-1.5 block text-xs">{t('lines.caveat', { full: both(Math.max(0, base - costs)) })}</span>}
    </span>
  );

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 sm:justify-end text-xs text-muted-foreground">
      <InfoHint hint={hint}>
        {t('label')} <span className="font-semibold text-foreground">≈ {fmt.format(net)}</span>
        {czk && <span className="font-semibold text-foreground"> · ≈ {czk.format(net * czkRate!)}</span>}
      </InfoHint>
      <select
        aria-label={t('flatRate')}
        className="rounded border border-border bg-background px-1 py-0.5 text-xs"
        value={rate}
        onChange={(e) => choose(Number(e.target.value) as FlatRate)}
      >
        {FLAT_RATES.map((r) => (
          <option key={r} value={r}>
            {r ? t('rate', { rate: r }) : t('noFlat')}
          </option>
        ))}
      </select>
    </div>
  );
}
