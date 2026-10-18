'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { VAT_RATES, vatFromBase, vatFromGross, type VatCountry } from '@faktur/cz-compliance';
import { AmountField, money, parseAmount, ResultRow, Segmented, SelectField } from '@/components/public-tools/fields';

/** VAT both ways, Czech or Slovak rates from @faktur/cz-compliance (VAT_RATES). */
export function VatCalculator({ defaultCountry }: { defaultCountry: VatCountry }) {
  const t = useTranslations('tools.calculators.items.vat');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const [country, setCountry] = useState<VatCountry>(defaultCountry);
  const [rate, setRate] = useState(String(VAT_RATES[defaultCountry].rates[0]));
  const [mode, setMode] = useState<'base' | 'gross'>('base');
  const [amount, setAmount] = useState('10 000');

  const rates = VAT_RATES[country].rates;
  const currency = country === 'SK' ? 'EUR' : 'CZK';
  const value = parseAmount(amount);
  const r = mode === 'base' ? vatFromBase(value, Number(rate)) : vatFromGross(value, Number(rate));
  const fmt = (n: number) => money(locale, n, currency, 2);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <Segmented
          label={t('fields.country')}
          value={country}
          onChange={(c) => {
            setCountry(c);
            setRate(String(VAT_RATES[c].rates[0]));
          }}
          options={(['CZ', 'SK'] as const).map((c) => ({ value: c, label: t(`countries.${c}`) }))}
        />
        <SelectField label={t('fields.rate')} value={rate} onChange={setRate} options={rates.map((v) => ({ value: String(v), label: `${v} %` }))} />
        <Segmented
          label={t('fields.mode')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'base', label: t('fields.fromBase') },
            { value: 'gross', label: t('fields.fromGross') }
          ]}
        />
        <AmountField label={`${t('fields.amount')} (${currency})`} value={amount} onChange={setAmount} />
      </form>
      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {tc('resultTitle')} · {t(`countries.${country}`)} {rate} %
        </h2>
        <dl className="mt-3 text-sm">
          <ResultRow label={t('result.base')} value={fmt(r.base)} />
          <ResultRow label={t('result.vat')} value={fmt(r.vat)} />
          <ResultRow label={t('result.gross')} value={fmt(r.gross)} strong />
        </dl>
      </section>
    </div>
  );
}
