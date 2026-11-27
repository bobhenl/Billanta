'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { YearIncomeInputs } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { FlatTaxCalculator, type FlatTaxPrefill } from '@/components/public-tools/flat-tax-calculator';
import { useVault } from '@/components/vault/vault-provider';
import { sealedYearIncome } from '@/lib/vault/sealed-exports';

type State = { kind: 'locked' } | { kind: 'loading' } | { kind: 'unreadable'; count: number } | { kind: 'ready'; prefill: FlatTaxPrefill };

/**
 * The calculator when some of the year's invoices have sealed amounts. The
 * server's year summary sends them with their envelope; this browser opens
 * them and adds them to the income the same way the roční přehled does
 * (sealedYearIncome). Without all of them the page prefills nothing: a
 * short income would tilt the comparison.
 */
export function SealedFlatTax({
  years,
  year,
  actualExpenses,
  inputs,
  before,
  after
}: {
  years: number[];
  year: number;
  actualExpenses: number;
  inputs: YearIncomeInputs;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const t = useTranslations('tools.calculators.items.flatTax.app');
  const tSealed = useTranslations('vault.amounts');
  const format = useFormatter();
  const { key, requestUnlock } = useVault();
  const [state, setState] = useState<State>({ kind: 'locked' });
  const count = inputs.sealedDocs.length;

  useEffect(() => {
    let alive = true;
    if (!key) {
      setState({ kind: 'locked' });
      return;
    }
    setState({ kind: 'loading' });
    sealedYearIncome(key, inputs)
      .then((out) => {
        if (!alive) return;
        setState(out.income == null ? { kind: 'unreadable', count: out.missing } : { kind: 'ready', prefill: { year, income: out.income, actualExpenses, vatPayer: inputs.vatPayer } });
      })
      .catch(() => alive && setState({ kind: 'unreadable', count }));
    return () => {
      alive = false;
    };
  }, [key, inputs, year, actualExpenses, count]);

  const czk = (n: number) => format.number(Math.round(n), { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
  const prefill = state.kind === 'ready' ? state.prefill : undefined;

  return (
    <>
      <div className="mb-6 space-y-2">
        {before}
        {state.kind === 'locked' && (
          <Banner tone="info">
            <span>{t('sealed', { count })}</span>{' '}
            <button type="button" onClick={() => void requestUnlock()} className="font-semibold text-primary hover:underline">
              {tSealed('unlock')}
            </button>
          </Banner>
        )}
        {state.kind === 'loading' && <p className="text-sm text-muted-foreground">{tSealed('reportOpening')}</p>}
        {state.kind === 'unreadable' && <Banner tone="warn">{t('sealedUnreadable', { count: state.count })}</Banner>}
        {prefill && (
          <Banner tone="info">
            {t('prefilled', { year: prefill.year, income: czk(prefill.income), expenses: czk(prefill.actualExpenses) })} {tSealed('reportIncluded', { count })}
          </Banner>
        )}
        {after}
      </div>
      {/* Remounted once the income is known: the calculator reads its prefill only on mount. */}
      <FlatTaxCalculator key={prefill ? 'opened' : 'empty'} years={years} prefill={prefill} />
    </>
  );
}
