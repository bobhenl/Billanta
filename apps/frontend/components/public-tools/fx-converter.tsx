'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeftRight } from 'lucide-react';
import { AmountField, parseAmount, ResultRow, SelectField } from '@/components/public-tools/fields';

/**
 * Converter over the ČNB list the page fetched on the server (CZK per 1 unit).
 * Any pair works: koruna is one more currency at rate 1, and a pair without
 * koruna goes through it (cross rate), which is how ČNB rates are meant to
 * be combined.
 */
export function FxConverter({ rates }: { rates: [string, number][] }) {
  const t = useTranslations('tools.calculators.items.fx');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const perCzk = new Map<string, number>([['CZK', 1], ...rates]);
  const codes = ['CZK', ...rates.map(([code]) => code).filter((c) => c !== 'CZK')];
  const [from, setFrom] = useState(codes.includes('EUR') ? 'EUR' : (codes[1] ?? 'CZK'));
  const [to, setTo] = useState('CZK');
  const [amount, setAmount] = useState('1 000');
  const fromRate = perCzk.get(from) ?? 0;
  const toRate = perCzk.get(to) ?? 0;
  const rate = toRate ? fromRate / toRate : 0;
  const value = parseAmount(amount);
  const result = value * rate;
  const number = (n: number, digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  const options = codes.map((c) => ({ value: c, label: c }));
  const crossed = from !== 'CZK' && to !== 'CZK' && from !== to;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <SelectField label={t('fields.from')} value={from} onChange={setFrom} options={options} />
          <button
            type="button"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
            aria-label={t('fields.swap')}
            title={t('fields.swap')}
            className="mb-0.5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
          </button>
          <SelectField label={t('fields.to')} value={to} onChange={setTo} options={options} />
        </div>
        <AmountField label={`${t('fields.amount')} (${from})`} value={amount} onChange={setAmount} />
      </form>
      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tc('resultTitle')}</h2>
        <dl className="mt-3 text-sm">
          <ResultRow label={`${number(value, 2)} ${from}`} value={`${number(result, 2)} ${to}`} strong />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{t('rate', { from, to, rate: number(rate, rate < 0.1 ? 6 : 4) })}</p>
        {crossed && <p className="mt-1 text-xs text-muted-foreground">{t('crossRate', { from, to })}</p>}
      </section>
    </div>
  );
}
