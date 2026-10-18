'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AmountField, money, parseAmount, ResultRow, Segmented, SelectField } from '@/components/public-tools/fields';

/** Converter over the ČNB list the page fetched on the server (CZK per 1 unit). */
export function FxConverter({ rates }: { rates: [string, number][] }) {
  const t = useTranslations('tools.calculators.items.fx');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const codes = rates.map(([code]) => code);
  const [code, setCode] = useState(codes.includes('EUR') ? 'EUR' : (codes[0] ?? ''));
  const [direction, setDirection] = useState<'to' | 'from'>('to');
  const [amount, setAmount] = useState('1 000');
  const rate = rates.find(([c]) => c === code)?.[1] ?? 0;
  const value = parseAmount(amount);
  const result = direction === 'to' ? value * rate : rate ? value / rate : 0;
  const number = (n: number, digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <Segmented
          label={t('fields.direction')}
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'to', label: t('fields.toCzk') },
            { value: 'from', label: t('fields.fromCzk') }
          ]}
        />
        <SelectField label={t('fields.currency')} value={code} onChange={setCode} options={codes.map((c) => ({ value: c, label: c }))} />
        <AmountField label={`${t('fields.amount')} (${direction === 'to' ? code : 'CZK'})`} value={amount} onChange={setAmount} />
      </form>
      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tc('resultTitle')}</h2>
        <dl className="mt-3 text-sm">
          <ResultRow
            label={direction === 'to' ? `${number(value, 2)} ${code}` : money(locale, value, 'CZK', 2)}
            value={direction === 'to' ? money(locale, result, 'CZK', 2) : `${number(result, 2)} ${code}`}
            strong
          />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{t('rate', { code, rate: number(rate, 3) })}</p>
      </section>
    </div>
  );
}
