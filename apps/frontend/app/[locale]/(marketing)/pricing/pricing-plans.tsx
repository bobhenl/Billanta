'use client';

import { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { PAYG_PRICE, type Plan, type PlanCurrency } from '@/lib/plans';

export type PlanCopy = { name: string; tagline: string; cta: string; features: string[] };

/** The comparison table, resolved on the server; string cells may hold `{payg}`. */
export type CompareCopy = {
  title: string;
  feature: string;
  yes: string;
  no: string;
  groups: { label: string; rows: { label: string; cells: (string | boolean)[] }[] }[];
};

type Labels = {
  yearly: string;
  monthly: string;
  yearlySave: string;
  period: string;
  currency: string;
  perMonth: string;
  /** Contains `{total}`, replaced with the formatted yearly sum. */
  billedYearly: string;
  billedMonthly: string;
  forever: string;
  popular: string;
  /** Contains `{payg}`, replaced with the per-document price. */
  paygNote: string;
  aiCreditNote: string;
};

/**
 * The plan cards with the two switches above them (billing period, currency).
 * The server page passes every string in, so this ships no message catalog.
 * Every card links to signup; the chosen plan rides along as `?plan=` for
 * when checkout exists.
 */
export function PricingPlans({
  plans,
  copy,
  labels,
  locale,
  initialCurrency,
  comparison
}: {
  plans: Plan[];
  copy: Record<string, PlanCopy>;
  labels: Labels;
  locale: string;
  initialCurrency: PlanCurrency;
  comparison: CompareCopy;
}) {
  const [yearly, setYearly] = useState(true);
  const [currency, setCurrency] = useState<PlanCurrency>(initialCurrency);

  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value);
  const payg = (text: string) => text.replace('{payg}', money(PAYG_PRICE[currency]));

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Segmented
          label={labels.period}
          value={yearly ? 'y' : 'm'}
          onChange={(v) => setYearly(v === 'y')}
          options={[
            { value: 'y', label: labels.yearly, badge: labels.yearlySave },
            { value: 'm', label: labels.monthly }
          ]}
        />
        <Segmented
          label={labels.currency}
          value={currency}
          onChange={(v) => setCurrency(v as PlanCurrency)}
          options={[
            { value: 'CZK', label: 'Kč' },
            { value: 'EUR', label: '€' }
          ]}
        />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const text = copy[plan.key];
          if (!text) return null;
          const price = plan.price[currency];
          const shown = yearly ? price.yearly : price.monthly;
          const free = price.monthly === 0;
          return (
            <article
              key={plan.key}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-card p-5',
                plan.popular ? 'border-primary shadow-md ring-1 ring-primary/30' : 'border-border'
              )}
            >
              {plan.popular && (
                <span className="absolute -top-2.5 left-5 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground">
                  {labels.popular}
                </span>
              )}
              <h2 className="text-base font-bold">{text.name}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{text.tagline}</p>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold tracking-tight">{money(shown)}</span>
                <span className="text-sm text-muted-foreground">{free ? labels.forever : labels.perMonth}</span>
              </p>
              <p className="mt-0.5 h-4 text-xs text-muted-foreground">
                {free ? '' : yearly ? labels.billedYearly.replace('{total}', money(price.yearly * 12)) : labels.billedMonthly}
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {text.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{payg(feature)}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={free ? '/signup' : `/signup?plan=${plan.key}`}
                className={cn(
                  'mt-5 inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-bold transition-opacity hover:opacity-90',
                  plan.popular ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground hover:border-primary/40'
                )}
              >
                {text.cta}
              </Link>
            </article>
          );
        })}
      </div>

      <div className="mt-4 space-y-1 text-sm text-muted-foreground">
        <p>{payg(labels.paygNote)}</p>
        <p>{labels.aiCreditNote}</p>
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{comparison.title}</h2>
      {/* Scrolls sideways on its own on a phone; the feature column stays put. */}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="sticky left-0 bg-card px-4 py-3 text-left font-semibold">
                {comparison.feature}
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.key}
                  scope="col"
                  className={cn('px-3 py-3 text-center font-bold', plan.popular && 'text-primary')}
                >
                  {copy[plan.key]?.name}
                </th>
              ))}
            </tr>
          </thead>
          {comparison.groups.map((group) => (
            <tbody key={group.label}>
              <tr className="bg-muted/50">
                <th
                  scope="colgroup"
                  colSpan={plans.length + 1}
                  className="sticky left-0 px-4 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {group.label}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.label} className="border-t border-border/60">
                  <th scope="row" className="sticky left-0 bg-card px-4 py-2.5 text-left font-normal">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={cn('px-3 py-2.5 text-center', plans[i]?.popular && 'bg-primary/[0.04]')}>
                      {cell === true ? (
                        <Check className="mx-auto h-4 w-4 text-primary" aria-label={comparison.yes} />
                      ) : cell === false ? (
                        <Minus className="mx-auto h-4 w-4 text-muted-foreground/50" aria-label={comparison.no} />
                      ) : (
                        <span className="text-xs font-medium sm:text-sm">{payg(cell)}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; badge?: string }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border bg-card p-0.5 text-sm">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold transition-colors',
            value === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
          {option.badge && (
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[10px] font-bold',
                value === option.value ? 'bg-primary-foreground/20' : 'bg-accent text-primary'
              )}
            >
              {option.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
