'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { NetIncomeInputs } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { useVault } from '@/components/vault/vault-provider';
import type { NetIncomeReport, PartnerMember, PeriodKind } from '@/lib/net-income';
import { sealedNetIncome } from '@/lib/vault/sealed-exports';
import { NetIncomeView } from './net-income-view';

type State = { kind: 'loading' } | { kind: 'locked' } | { kind: 'unreadable'; count: number } | { kind: 'failed' } | { kind: 'ready'; report: NetIncomeReport };

/**
 * The report when some of the period's paid documents have sealed amounts.
 * The server's report leaves them out; after unlock this browser fetches
 * the same inputs with their envelopes, opens them and builds the whole
 * report with the server's own function (cz-compliance). Nothing opened
 * goes back. Until then, or when a document stays shut, the server's
 * report shows with a note of what it is missing.
 */
export function SealedNetIncome({
  report,
  query,
  ...view
}: {
  report: NetIncomeReport;
  query: string;
  kind: PeriodKind;
  canEdit: boolean;
  canSplit: boolean;
  members: PartnerMember[];
}) {
  const t = useTranslations('netIncome.sealed');
  const tSealed = useTranslations('vault.amounts');
  const { key, requestUnlock } = useVault();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const count = report.sealed?.count ?? 0;

  useEffect(() => {
    let alive = true;
    if (!key) {
      setState({ kind: 'locked' });
      return;
    }
    setState({ kind: 'loading' });
    fetch(`/api/files/net-income/inputs?${query}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<NetIncomeInputs>;
      })
      .then((inputs) => sealedNetIncome(key, inputs))
      .then((out) => {
        if (!alive) return;
        setState(out.report ? { kind: 'ready', report: { ...out.report, sealed: report.sealed } } : { kind: 'unreadable', count: out.missing });
      })
      .catch(() => alive && setState({ kind: 'failed' }));
    return () => {
      alive = false;
    };
    // The server's report changes after a split is saved (router.refresh): the inputs are fetched again.
  }, [key, query, report]);

  return (
    <>
      {state.kind === 'locked' && (
        <Banner tone="info" className="mt-4">
          <span>{t('locked', { count })}</span>{' '}
          <button type="button" onClick={() => void requestUnlock()} className="font-semibold text-primary hover:underline">
            {tSealed('unlock')}
          </button>
        </Banner>
      )}
      {state.kind === 'loading' && <p className="mt-4 text-sm text-muted-foreground">{tSealed('reportOpening')}</p>}
      {state.kind === 'ready' && <p className="mt-4 text-sm text-muted-foreground">{tSealed('reportIncluded', { count })}</p>}
      {state.kind === 'unreadable' && (
        <Banner tone="warn" className="mt-4">
          {t('unreadable', { count: state.count })}
        </Banner>
      )}
      {state.kind === 'failed' && (
        <Banner tone="warn" className="mt-4">
          {t('failed', { count })}
        </Banner>
      )}
      <NetIncomeView report={state.kind === 'ready' ? state.report : report} {...view} />
    </>
  );
}
