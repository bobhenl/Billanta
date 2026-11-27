'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { AUDIT_FX_TOLERANCE, csvCell, type AuditInvoiceStatus, type PaymentAuditInputs, type PaymentAuditReport } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { useVault } from '@/components/vault/vault-provider';
import { Link } from '@/i18n/navigation';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { AUDIT_OK, AUDIT_PROBLEMS, auditSourceName, type PaymentAuditResponse } from '@/lib/payment-audit';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { saveText, sealedPaymentAudit } from '@/lib/vault/sealed-exports';

type Sealed = { kind: 'none' } | { kind: 'loading' } | { kind: 'locked' } | { kind: 'failed' } | { kind: 'ready'; report: PaymentAuditReport; missing: number };
type Filter = 'problems' | 'all' | AuditInvoiceStatus;

const TONE: Record<AuditInvoiceStatus, string> = {
  paid: 'bg-success/10 text-success',
  paid_fee: 'bg-success/10 text-success',
  underpaid: 'bg-warning/10 text-warning',
  overpaid: 'bg-accent text-primary',
  unpaid: 'bg-destructive/10 text-destructive',
  manual: 'bg-warning/10 text-warning',
  sealed: 'bg-secondary text-muted-foreground',
  unverified: 'bg-secondary text-muted-foreground'
};

/**
 * The audit. With sealed amounts the server's report has those invoices as
 * "sealed"; after unlock this browser fetches the inputs with the envelopes,
 * opens them and builds the report with the same function (cz-compliance).
 * Nothing opened goes back.
 */
export function PaymentAuditView({ report: server }: { report: PaymentAuditResponse }) {
  const t = useTranslations('paymentAudit');
  const tSealed = useTranslations('vault.amounts');
  const locale = useLocale();
  const { key, requestUnlock } = useVault();
  const sealedCount = server.sealed?.count ?? 0;
  const [sealed, setSealed] = useState<Sealed>({ kind: sealedCount ? 'loading' : 'none' });
  const [filter, setFilter] = useState<Filter>('problems');

  useEffect(() => {
    if (!sealedCount) return;
    let alive = true;
    if (!key) {
      setSealed({ kind: 'locked' });
      return;
    }
    setSealed({ kind: 'loading' });
    fetch(`/api/files/payment-audit/inputs?year=${server.year}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<PaymentAuditInputs>;
      })
      .then((inputs) => sealedPaymentAudit(key, inputs))
      .then((out) => alive && setSealed({ kind: 'ready', ...out }))
      .catch(() => alive && setSealed({ kind: 'failed' }));
    return () => {
      alive = false;
    };
  }, [key, sealedCount, server.year]);

  const report: PaymentAuditReport = sealed.kind === 'ready' ? sealed.report : server;
  const money = (v: number | null, currency: string) => (v == null ? '–' : formatMoney(v, currency, locale));
  const home = (v: number) => formatMoney(v, report.home, locale);
  const sourceName = (k: string) => auditSourceName(k, report.sourceNames, t);
  const by = report.totals.byStatus;
  const problems = AUDIT_PROBLEMS.reduce((n, s) => n + by[s], 0);

  const rows = useMemo(
    () =>
      report.invoices.filter((i) => (filter === 'all' ? true : filter === 'problems' ? AUDIT_PROBLEMS.includes(i.status) : i.status === filter)),
    [report, filter]
  );
  const chips: { key: Filter; count: number }[] = [
    { key: 'problems', count: problems },
    { key: 'all', count: report.invoices.length },
    ...[...AUDIT_PROBLEMS, ...AUDIT_OK].filter((s) => by[s] > 0).map((s) => ({ key: s as Filter, count: by[s] }))
  ];

  const statusText = (i: PaymentAuditReport['invoices'][number]) => (i.status === 'paid_fee' ? t('status.paidFee', { fee: money(i.fee, i.currency) }) : t(`status.${i.status}`));

  function exportCsv() {
    const head = [t('csv.kind'), t('cols.number'), t('cols.date'), t('cols.party'), t('cols.currency'), t('cols.total'), t('cols.received'), t('cols.fee'), t('cols.difference'), t('cols.differenceHome', { home: report.home }), t('cols.status'), t('cols.sources')];
    const lines = [head.map(csvCell).join(';')];
    for (const i of report.invoices) {
      lines.push(
        [t('csv.invoice'), i.number, i.paidAt ?? i.issueDate, i.customer, i.currency, i.total, i.received, i.fee || null, i.difference, i.differenceHome, statusText(i), i.sources.map(sourceName).join(', ')]
          .map(csvCell)
          .join(';')
      );
    }
    for (const x of report.transactions) {
      lines.push(
        [t('csv.payment'), x.variableSymbol, x.date, x.counterpartyName, x.currency, x.amount, null, x.fee, null, x.homeAmount, t(`txStatus.${x.status}`), sourceName(x.source)].map(csvCell).join(';')
      );
    }
    // BOM: Excel otherwise reads the UTF-8 file as cp1250 and mangles diacritics.
    saveText(`audit-plateb-${report.year}.csv`, new Blob([`﻿${lines.join('\r\n')}\r\n`]), 'text/csv;charset=utf-8');
  }

  return (
    <>
      {sealed.kind === 'locked' && (
        <Banner tone="info" className="mt-4">
          <span>{t('sealed.locked', { count: sealedCount })}</span>{' '}
          <button type="button" onClick={() => void requestUnlock()} className="font-semibold text-primary hover:underline">
            {tSealed('unlock')}
          </button>
        </Banner>
      )}
      {sealed.kind === 'loading' && <p className="mt-4 text-sm text-muted-foreground">{tSealed('reportOpening')}</p>}
      {sealed.kind === 'ready' && !sealed.missing && <p className="mt-4 text-sm text-muted-foreground">{tSealed('reportIncluded', { count: sealedCount })}</p>}
      {sealed.kind === 'ready' && sealed.missing > 0 && (
        <Banner tone="warn" className="mt-4">
          {t('sealed.unreadable', { count: sealed.missing })}
        </Banner>
      )}
      {sealed.kind === 'failed' && (
        <Banner tone="warn" className="mt-4">
          {t('sealed.failed', { count: sealedCount })}
        </Banner>
      )}

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label={t('cards.invoices')} value={String(report.invoices.length)} />
        <Card label={t('cards.problems')} value={String(problems)} accent={problems > 0} />
        <Card label={t('cards.underpaid', { home: report.home })} value={home(report.totals.underpaidHome)} />
        <Card label={t('cards.withoutInvoice')} value={`${report.totals.withoutInvoice.count} · ${home(report.totals.withoutInvoice.homeAmount)}`} />
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card" aria-labelledby="audit-invoices">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id="audit-invoices" className="font-bold">
            {t('invoices.heading')}
          </h2>
          <button type="button" onClick={exportCsv} className={cn(buttonClass.secondary, 'gap-1.5')}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('export')}
          </button>
        </div>
        <div className="-mb-px flex gap-1.5 overflow-x-auto px-4 py-3 [scrollbar-width:none]" role="group" aria-label={t('filterLabel')}>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors',
                filter === c.key ? 'border-primary bg-accent text-primary' : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {c.key === 'problems' || c.key === 'all' ? t(`filter.${c.key}`) : t(`status.${c.key === 'paid_fee' ? 'paidFeeShort' : c.key}`)}
              <span className="tabular-nums">{c.count}</span>
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">{t(filter === 'problems' ? 'invoices.noProblems' : 'invoices.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">{t('cols.number')}</th>
                  <th className="px-3 py-2 font-semibold">{t('cols.party')}</th>
                  <th className="px-3 py-2 font-semibold">{t('cols.date')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('cols.total')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('cols.received')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('cols.difference')}</th>
                  <th className="px-4 py-2 font-semibold">{t('cols.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="px-4 py-2 font-semibold">
                      <Link href={`/invoices/${i.id}`} className="text-primary hover:underline">
                        {i.number}
                      </Link>
                    </td>
                    <td className="max-w-[14rem] truncate px-3 py-2">{i.customer}</td>
                    <td className="px-3 py-2 tabular-nums">{formatDate(i.paidAt ?? i.issueDate, locale)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(i.total, i.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(i.received, i.currency)}
                      {i.sources.length > 0 && <span className="block text-xs text-muted-foreground">{i.sources.map(sourceName).join(', ')}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {i.difference && (i.status === 'underpaid' || i.status === 'overpaid') ? (
                        <>
                          {money(i.difference, i.currency)}
                          {i.currency !== report.home && i.differenceHome != null && <span className="block text-xs text-muted-foreground">{home(i.differenceHome)}</span>}
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', TONE[i.status])}>{statusText(i)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{t('invoices.note', { percent: AUDIT_FX_TOLERANCE * 100 })}</p>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card" aria-labelledby="audit-payments">
        <div className="border-b border-border px-4 py-3">
          <h2 id="audit-payments" className="font-bold">
            {t('transactions.heading')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('transactions.intro')}</p>
        </div>
        {report.transactions.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('transactions.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">{t('cols.date')}</th>
                  <th className="px-3 py-2 font-semibold">{t('cols.payer')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('cols.amount')}</th>
                  <th className="px-3 py-2 font-semibold">{t('cols.source')}</th>
                  <th className="px-4 py-2 font-semibold">{t('cols.status')}</th>
                </tr>
              </thead>
              <tbody>
                {report.transactions.map((x) => (
                  <tr key={x.id} className="border-t border-border">
                    <td className="px-4 py-2 tabular-nums">
                      <Link href={`/bank/${x.id}`} className="text-primary hover:underline">
                        {formatDate(x.date, locale)}
                      </Link>
                    </td>
                    <td className="max-w-[14rem] px-3 py-2">
                      <span className="block truncate">{x.counterpartyName || '–'}</span>
                      {(x.variableSymbol || x.message) && <span className="block truncate text-xs text-muted-foreground">{[x.variableSymbol && `VS ${x.variableSymbol}`, x.message].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(x.amount, x.currency)}</td>
                    <td className="px-3 py-2">{sourceName(x.source)}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs font-semibold">{t(`txStatus.${x.status}`)}</span>
                      {x.status === 'not_issued' && x.matchedInvoiceId && (
                        <Link href={`/invoices/${x.matchedInvoiceId}`} className="block text-xs text-primary hover:underline">
                          {x.matchedInvoiceNumber ?? t('transactions.draft')}
                        </Link>
                      )}
                      {x.likelyTransfer && <span className="block text-xs text-muted-foreground">{t('transactions.likelyTransfer')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card" aria-labelledby="audit-sources">
        <h2 id="audit-sources" className="border-b border-border px-4 py-3 font-bold">
          {t('sources.heading')}
        </h2>
        {report.sources.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('sources.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">{t('cols.source')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('sources.incoming')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('sources.paired')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('sources.withoutInvoice')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('sources.ignored')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('sources.ownMoves')}</th>
                  <th className="px-4 py-2 text-right font-semibold">{t('cols.fee')}</th>
                </tr>
              </thead>
              <tbody>
                {report.sources.map((s) => (
                  <tr key={`${s.source}|${s.currency}`} className="border-t border-border">
                    <td className="px-4 py-2 font-semibold">
                      {sourceName(s.source)} <span className="font-normal text-muted-foreground">{s.currency}</span>
                    </td>
                    <BucketCell b={s.incoming} currency={s.currency} money={money} />
                    <BucketCell b={s.paired} currency={s.currency} money={money} />
                    <BucketCell b={s.withoutInvoice} currency={s.currency} money={money} />
                    <BucketCell b={s.ignored} currency={s.currency} money={money} />
                    <BucketCell b={s.ownMoves} currency={s.currency} money={money} />
                    <td className="px-4 py-2 text-right tabular-nums">{s.fees ? money(s.fees, s.currency) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.totals.feesHome > 0 && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{t('sources.feesNote', { fees: home(report.totals.feesHome) })}</p>}
      </section>
    </>
  );
}

function BucketCell({ b, currency, money }: { b: { count: number; amount: number }; currency: string; money: (v: number | null, c: string) => string }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {b.count ? (
        <>
          {money(b.amount, currency)}
          <span className="block text-xs text-muted-foreground">{b.count}×</span>
        </>
      ) : (
        '–'
      )}
    </td>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-xl font-extrabold tabular-nums sm:text-2xl', accent && 'text-warning')}>{value}</p>
    </div>
  );
}
