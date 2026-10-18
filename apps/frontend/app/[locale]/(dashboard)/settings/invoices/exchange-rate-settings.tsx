'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { HomeCurrency, VatStatus } from '@faktur/cz-compliance';
import { InfoHint } from '@/components/info-hint';
import { inputClass } from '@/components/modal';
import { cn } from '@/lib/utils';
import { RATE_CURRENCIES, type ExchangeRateSetting, type ReportRateMode } from '../../invoices/new/types';

/** One editable row of the annual-rate table (text while typing). */
export interface AnnualRateDraft {
  year: string;
  currency: string;
  rate: string;
}

/** Jednotný kurz computed from ČNB month-end rates (backend GET /dashboard/fx-rates/uniform). */
export interface UniformYear {
  year: number;
  rates: { code: string; rate: number | null; months: number; final: boolean }[];
}

/** Rows that are complete and valid, as the backend takes them; null when two rows share a year and currency. */
export function annualRatesOf(rows: AnnualRateDraft[]): { year: number; currency: string; rate: number }[] | null {
  const out = rows
    .map((r) => ({ year: Number(r.year), currency: r.currency, rate: Number(r.rate.replace(',', '.')) }))
    .filter((r) => Number.isInteger(r.year) && r.year >= 2000 && r.year <= 2100 && /^[A-Z]{3}$/.test(r.currency) && r.rate > 0);
  return new Set(out.map((r) => `${r.year}:${r.currency}`)).size === out.length ? out : null;
}

/**
 * Settings → Faktury → Kurz u faktur v cizí měně, in two parts: what the
 * invoice prints (daily ČNB rate, or nothing for a non-payer; the backend
 * ignores "none" for a payer anyway, here it is disabled with the reason),
 * and which rate reports use (daily, or the jednotný kurz computed from ČNB
 * month-end rates, with the company's own value per year over it).
 * A Slovak company (home EUR) gets the ECB rate and no jednotný kurz.
 */
export function ExchangeRateSettings({
  mode,
  onModeChange,
  reportMode,
  onReportModeChange,
  rates,
  onRatesChange,
  uniform,
  vatStatus,
  home = 'CZK',
  readOnly,
  className
}: {
  mode: ExchangeRateSetting;
  onModeChange: (mode: ExchangeRateSetting) => void;
  reportMode: ReportRateMode;
  onReportModeChange: (mode: ReportRateMode) => void;
  rates: AnnualRateDraft[];
  onRatesChange: (rates: AnnualRateDraft[]) => void;
  /** Null when ČNB could not be reached. */
  uniform: UniformYear[] | null;
  vatStatus: VatStatus;
  home?: HomeCurrency;
  readOnly: boolean;
  className?: string;
}) {
  const t = useTranslations('settings.invoices.rate');
  const locale = useLocale();
  const payer = vatStatus === 'payer';
  const duplicate = annualRatesOf(rates) === null;
  const eur = home === 'EUR';
  const nonePayer = eur ? t('nonePayerEcb') : t('nonePayer');
  const options: { value: ExchangeRateSetting; label: string; disabled: boolean; hint: string }[] = [
    { value: 'cnb_daily', label: eur ? t('modes.ecb_daily') : t('modes.cnb_daily'), disabled: false, hint: eur ? t('ecbDailyHint') : t('cnbDailyHint') },
    {
      value: 'none',
      label: t('modes.none', { home }),
      disabled: payer,
      hint: payer ? nonePayer : vatStatus === 'identified' ? t('noneIdentified') : eur ? t('noneHintEcb') : t('noneHint')
    }
  ];
  // The stored "daily" setting means the official rate of the home country.
  const shown = mode;
  const reportOptions: { value: ReportRateMode; hint: string }[] = [
    { value: 'daily', hint: t('reportDailyHint') },
    { value: 'annual', hint: t('annualHint') }
  ];
  const computed = (year: string, currency: string) =>
    uniform?.find((y) => String(y.year) === year)?.rates.find((r) => r.code === currency && r.rate != null) ?? null;
  const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 4 });
  const setRow = (i: number, patch: Partial<AnnualRateDraft>) => onRatesChange(rates.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // A new year or currency on a row still showing the computed value (or nothing) takes the new computed value.
  const retarget = (i: number, patch: Pick<Partial<AnnualRateDraft>, 'year' | 'currency'>) => {
    const row = rates[i]!;
    const before = computed(row.year, row.currency);
    const after = computed(patch.year ?? row.year, patch.currency ?? row.currency);
    const untouched = row.rate === '' || (before != null && row.rate === String(before.rate));
    setRow(i, untouched ? { ...patch, rate: after ? String(after.rate) : '' } : patch);
  };
  const status = (r: { months: number; final: boolean }) => (r.final ? t('final') : t('running', { n: r.months }));
  const computedRows = (uniform ?? []).flatMap((y) => y.rates.filter((r) => r.rate != null).map((r) => ({ year: y.year, ...r, rate: r.rate! })));

  return (
    <section id="exchange-rate" className={cn(className, 'scroll-mt-20')}>
      <InfoHint hint={eur ? t('hintEur') : t('hint')}>
        <h2 className="font-bold">{t('title')}</h2>
      </InfoHint>

      <h3 className="mt-3 text-sm font-semibold">{t('invoiceTitle')}</h3>
      <div role="radiogroup" aria-label={t('invoiceTitle')} className="mt-2 space-y-3">
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

      {/* Slovak law has no jednotný kurz: reports use the ECB rate of each day. */}
      {!eur && (
        <>
          <h3 className="mt-5 text-sm font-semibold">{t('reportTitle')}</h3>
          <div role="radiogroup" aria-label={t('reportTitle')} className="mt-2 space-y-3">
            {reportOptions.map((o) => (
              <label key={o.value} className={cn('flex items-start gap-2.5 text-sm', readOnly && 'opacity-70')}>
                <input
                  type="radio"
                  name="report-rate-mode"
                  value={o.value}
                  checked={reportMode === o.value}
                  disabled={readOnly}
                  onChange={() => onReportModeChange(o.value)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="font-medium">{t(`reportModes.${o.value}`)}</span>
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>

        </>
      )}

      {!eur && reportMode === 'annual' && (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">{t('invoiceStaysDaily')}</p>
          <h4 className="mt-3 text-sm font-semibold">{t('computedTitle')}</h4>
          {uniform === null ? (
            <p className="mt-1 text-xs text-warning">{t('computedError')}</p>
          ) : computedRows.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">{t('computedEmpty')}</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {computedRows.map((r) => (
                <li key={`${r.year}:${r.code}`} className="tabular-nums">
                  {r.year} · {r.code}: <span className="font-medium">{fmt(r.rate)}</span> {t('perUnit', { currency: r.code })}{' '}
                  <span className="text-xs text-muted-foreground">({status(r)})</span>
                </li>
              ))}
            </ul>
          )}

          <h4 className="mt-4 text-sm font-semibold">{t('annualTitle')}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{rates.length === 0 ? t('annualEmpty') : t('annualOverrideHint')}</p>
          <div className="mt-2 space-y-2">
            {rates.map((r, i) => {
              const auto = computed(r.year, r.currency);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    inputMode="numeric"
                    aria-label={t('year')}
                    className={cn(inputClass, 'h-9 w-24')}
                    value={r.year}
                    disabled={readOnly}
                    onChange={(e) => retarget(i, { year: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  />
                  <select
                    aria-label={t('currency')}
                    className={cn(inputClass, 'h-9 w-24')}
                    value={r.currency}
                    disabled={readOnly}
                    onChange={(e) => retarget(i, { currency: e.target.value })}
                  >
                    {[...new Set([...RATE_CURRENCIES, r.currency])].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="decimal"
                    aria-label={t('rate')}
                    placeholder={auto ? fmt(auto.rate!) : t('rate')}
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
                  {auto && <span className="basis-full text-xs text-muted-foreground">{t('computedValue', { rate: fmt(auto.rate!), status: status(auto) })}</span>}
                </div>
              );
            })}
          </div>
          {duplicate && <p className="mt-2 text-xs text-destructive">{t('duplicate')}</p>}
          <button
            type="button"
            disabled={readOnly}
            onClick={() => {
              // Last year first: its value is final and the one an override is usually for.
              const year = String(new Date().getFullYear() - 1);
              const auto = computed(year, 'EUR');
              onRatesChange([...rates, { year, currency: 'EUR', rate: auto ? String(auto.rate) : '' }]);
            }}
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
