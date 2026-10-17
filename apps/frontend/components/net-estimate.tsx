'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { netAfterTaxes } from '@/lib/net-estimate';

/** Paušální výdaje an OSVČ can pick; 0 = no flat rate (all income is profit). */
const FLAT_RATES = [60, 80, 40, 30, 0] as const;
type FlatRate = (typeof FLAT_RATES)[number];
const STORAGE_KEY = 'billanta.netEstimate.flatRate';

/**
 * "Roughly how much of this invoice you keep" — base without VAT minus tax and insurance.
 * On a foreign-currency invoice `czkRate` adds the amount in CZK, the currency the tax is paid in.
 */
export function NetEstimate({ base, currency, czkRate }: { base: number; currency: string; czkRate?: number }) {
  const t = useTranslations('netEstimate');
  const locale = useLocale();
  const [rate, setRate] = useState<FlatRate>(60);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if ((FLAT_RATES as readonly number[]).includes(saved) && localStorage.getItem(STORAGE_KEY) !== null) setRate(saved as FlatRate);
    } catch {
      /* storage blocked — keep the default */
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
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
  const { net, burden } = netAfterTaxes(base, rate);
  const czk = currency !== 'CZK' && czkRate && czkRate > 0 ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }) : null;
  const both = (amount: number) => (czk ? `${fmt.format(amount)} (≈ ${czk.format(amount * czkRate!)})` : fmt.format(amount));

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 sm:justify-end text-xs text-muted-foreground">
      <InfoHint hint={t('hint', { burden: both(burden) })}>
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
