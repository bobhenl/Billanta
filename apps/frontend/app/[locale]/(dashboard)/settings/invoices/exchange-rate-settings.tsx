'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { HomeCurrency, VatStatus } from '@faktur/cz-compliance';
import { InfoHint } from '@/components/info-hint';
import { inputClass } from '@/components/modal';
import { cn } from '@/lib/utils';
import type { ExchangeRateSetting } from '../../invoices/new/types';

/** One editable row of the annual-rate table (text while typing). */
export interface AnnualRateDraft {
  year: string;
  currency: string;
  rate: string;
}

const RATE_CURRENCIES = ['EUR', 'USD', 'GBP', 'PLN'];

/** Rows that are complete and valid, as the backend takes them; null when two rows share a year and currency. */
export function annualRatesOf(rows: AnnualRateDraft[]): { year: number; currency: string; rate: number }[] | null {
  const out = rows
    .map((r) => ({ year: Number(r.year), currency: r.currency, rate: Number(r.rate.replace(',', '.')) }))
    .filter((r) => Number.isInteger(r.year) && r.year >= 2000 && r.year <= 2100 && /^[A-Z]{3}$/.test(r.currency) && r.rate > 0);
  return new Set(out.map((r) => `${r.year}:${r.currency}`)).size === out.length ? out : null;
}

/**
 * Settings → Faktury → Kurz pro cizí měny. "Netisknout" is only for a
 * company that is not a VAT payer; the backend ignores it for a payer anyway
 * (invoices/exchange-rate-mode.ts), here it is disabled with the reason.
 * A Slovak company (home EUR) gets the ECB rate and no annual option.
 */
export function ExchangeRateSettings({
  mode,
  onModeChange,
  rates,
  onRatesChange,
  vatStatus,
  home = 'CZK',
  readOnly,
  className
}: {
  mode: ExchangeRateSetting;
  onModeChange: (mode: ExchangeRateSetting) => void;
  rates: AnnualRateDraft[];
  onRatesChange: (rates: AnnualRateDraft[]) => void;
  vatStatus: VatStatus;
  home?: HomeCurrency;
  readOnly: boolean;
  className?: string;
}) {
  const t = useTranslations('settings.invoices.rate');
  const payer = vatStatus === 'payer';
  const duplicate = annualRatesOf(rates) === null;
  const eur = home === 'EUR';
  const nonePayer = eur ? t('nonePayerEcb') : t('nonePayer');
  const options: { value: ExchangeRateSetting; label: string; disabled: boolean; hint: string }[] = [
    { value: 'cnb_daily', label: eur ? t('modes.ecb_daily') : t('modes.cnb_daily'), disabled: false, hint: eur ? t('ecbDailyHint') : t('cnbDailyHint') },
    ...(eur ? [] : [{ value: 'annual' as const, label: t('modes.annual'), disabled: false, hint: t('annualHint') }]),
    {
      value: 'none',
      label: t('modes.none', { home }),
      disabled: payer,
      hint: payer ? nonePayer : vatStatus === 'identified' ? t('noneIdentified') : eur ? t('noneHintEcb') : t('noneHint')
    }
  ];
  // The stored "daily" setting means the official rate of the home country; an annual one does not apply in SK.
  const shown = eur && mode === 'annual' ? 'cnb_daily' : mode;
  const setRow = (i: number, patch: Partial<AnnualRateDraft>) => onRatesChange(rates.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <section id="exchange-rate" className={cn(className, 'scroll-mt-20')}>
      <InfoHint hint={eur ? t('hintEur') : t('hint')}>
        <h2 className="font-bold">{t('title')}</h2>
      </InfoHint>
      <div role="radiogroup" aria-label={t('title')} className="mt-3 space-y-3">
        {options.map((o) => (
          <label key={o.value} className={cn('flex items-start gap-2.5 text-sm', (readOnly || o.disabled) && 'opacity-70')}>
            <input
              type="radio"
              name="exchange-rate-mode"
              value={o.value}
              checked={shown === o.value}
              disabled={readOnly || o.disabled}
              onChange={() => onModeChange(o.value)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              <span className="font-medium">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {payer && mode === 'none' && <p className="mt-2 text-xs text-warning">{nonePayer}</p>}

      {shown === 'annual' && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t('annualTitle')}</h3>
          {rates.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{t('annualEmpty')}</p>}
          <div className="mt-2 space-y-2">
            {rates.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  inputMode="numeric"
                  aria-label={t('year')}
                  className={cn(inputClass, 'h-9 w-24')}
                  value={r.year}
                  disabled={readOnly}
                  onChange={(e) => setRow(i, { year: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                />
                <select
                  aria-label={t('currency')}
                  className={cn(inputClass, 'h-9 w-24')}
                  value={r.currency}
                  disabled={readOnly}
                  onChange={(e) => setRow(i, { currency: e.target.value })}
                >
                  {RATE_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  aria-label={t('rate')}
                  placeholder={t('rate')}
                  className={cn(inputClass, 'h-9 w-36')}
                  value={r.rate}
                  disabled={readOnly}
                  onChange={(e) => setRow(i, { rate: e.target.value.replace(/[^\d.,]/g, '') })}
                />
                <span className="text-xs text-muted-foreground">{t('perUnit', { currency: r.currency })}</span>
                <button
                  type="button"
                  disabled={readOnly}
                  aria-label={t('remove')}
                  onClick={() => onRatesChange(rates.filter((_, j) => j !== i))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          {duplicate && <p className="mt-2 text-xs text-destructive">{t('duplicate')}</p>}
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onRatesChange([...rates, { year: String(new Date().getFullYear()), currency: 'EUR', rate: '' }])}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t('add')}
          </button>
        </div>
      )}
    </section>
  );
}
