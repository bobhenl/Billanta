'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { taxReturnCsv, taxReturnFileName, type TaxReturnInputs, type TaxReturnReport, type VaultKey } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { PlanLock } from '@/components/plan-lock';
import { toast } from '@/components/toaster';
import { useVault } from '@/components/vault/vault-provider';
import { Link } from '@/i18n/navigation';
import type { PaidPlanKey } from '@/lib/plan';
import { drawTaxReturnPdf } from '@/lib/vault/documents';
import { saveText, sealedTaxReturn } from '@/lib/vault/sealed-exports';
import { TaxReturnDownloads, TaxReturnView, type TaxReturnData, type Translate } from './tax-return-view';

const calendarDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The report as the page shows it: deadlines as calendar days, like the backend sends them. */
function asData(r: TaxReturnReport): TaxReturnData {
  return { ...r, deadlines: r.deadlines.map((d) => ({ kind: d.kind, date: calendarDay(new Date(d.date)) })) };
}

type State = { kind: 'loading' } | { kind: 'locked' } | { kind: 'unreadable'; count: number } | { kind: 'failed' } | { kind: 'ready'; report: TaxReturnReport; sealed: number };

/**
 * The tax-return basis when some of the year's invoices have sealed
 * amounts. The server sends everything apart from their income; this
 * browser opens them and computes the same report with the same function.
 * Nothing opened goes back. A document that stays shut means no figures.
 */
export function SealedTaxReturn({ year, rate, years, thisYear, lock }: { year: number; rate: string; years: number[]; thisYear: number; lock: PaidPlanKey | null }) {
  const t = useTranslations('taxReturn');
  const tCat = useTranslations('expenses.category');
  const tSealed = useTranslations('vault.amounts');
  const locale = useLocale();
  const { key, requestUnlock } = useVault();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const query = `year=${year}&rate=${rate}`;

  async function compute(k: VaultKey, file?: 'csv' | 'pdf') {
    const res = await fetch(`/api/files/exports/tax-return-basis-inputs?${query}${file ? `&file=${file}` : ''}`);
    if (!res.ok) throw new Error(String(res.status));
    const inputs = (await res.json()) as TaxReturnInputs;
    return { ...(await sealedTaxReturn(k, inputs)), sealed: inputs.sealedDocs.length };
  }

  useEffect(() => {
    let alive = true;
    if (!key) {
      setState({ kind: 'locked' });
      return;
    }
    setState({ kind: 'loading' });
    compute(key)
      .then((out) => alive && setState(out.report ? { kind: 'ready', report: out.report, sealed: out.sealed } : { kind: 'unreadable', count: out.missing }))
      .catch(() => alive && setState({ kind: 'failed' }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, query]);

  /** The file is built here; the inputs route counts it on the plan. */
  async function download(file: 'csv' | 'pdf') {
    if (!key) return;
    setBusy(true);
    try {
      const { report, missing } = await compute(key, file);
      if (!report) {
        toast({ text: tSealed('exportUnreadable', { count: missing }), tone: 'err' });
        return;
      }
      const name = taxReturnFileName(report);
      if (file === 'csv') saveText(`${name}.csv`, taxReturnCsv(report), 'text/csv;charset=utf-8');
      else saveText(`${name}.pdf`, await drawTaxReturnPdf(report), 'application/pdf');
    } catch {
      toast({ text: t('loadError'), tone: 'err' });
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'ready') {
    const tt = t as unknown as Translate;
    return (
      <TaxReturnView
        r={asData(state.report)}
        t={tt}
        tCat={tCat as unknown as Translate}
        locale={locale}
        year={year}
        rate={rate}
        years={years}
        thisYear={thisYear}
        sealedNote={tSealed('reportIncluded', { count: state.sealed })}
        downloads={lock ? <PlanLock plan={lock} /> : <TaxReturnDownloads t={tt} query={query} onPick={download} busy={busy} />}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('back')}
      </Link>
      <h1 className="mt-2 flex items-start gap-2 text-2xl font-extrabold tracking-tight">
        <FileText className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <span>{t('title', { year })}</span>
      </h1>
      {state.kind === 'loading' && <p className="mt-6 text-sm text-muted-foreground">{tSealed('reportOpening')}</p>}
      {state.kind === 'failed' && (
        <Banner tone="err" className="mt-6">
          {t('loadError')}
        </Banner>
      )}
      {state.kind === 'unreadable' && (
        <Banner tone="err" className="mt-6">
          {tSealed('reportUnreadable', { count: state.count })}
        </Banner>
      )}
      {state.kind === 'locked' && (
        <Banner tone="info" className="mt-6">
          <span>{tSealed('reportLocked')}</span>{' '}
          <button type="button" onClick={() => void requestUnlock()} className="font-semibold text-primary hover:underline">
            {tSealed('unlock')}
          </button>
        </Banner>
      )}
    </div>
  );
}
