import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, FileText } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { apiFetch, ApiError, NotSignedInError } from '@/lib/api-client';
import { formatDate, formatMoney, type InvoiceRow } from '@/lib/invoice-ui';
import { rankCandidates, TX_STATUS_CLASSES, type BankTransactionDetail } from '@/lib/bank-ui';
import { cn } from '@/lib/utils';
import { TransactionActions } from './transaction-actions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bank.detail');
  return { title: t('title') };
}

export default async function BankTransactionPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID.test(params.id)) notFound();
  const locale = await getLocale();
  const t = await getTranslations('bank');

  let tx: BankTransactionDetail;
  try {
    tx = await apiFetch<BankTransactionDetail>(`/api/v1/bank-reconciliation/transactions/${params.id}`);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <Banner tone="err" title={t('loadError')} className="mt-6">
        <span className="font-mono text-xs">{String(error instanceof Error ? error.message : error)}</span>
      </Banner>
    );
  }

  const invoices = await apiFetch<InvoiceRow[]>('/api/v1/invoices').catch(() => [] as InvoiceRow[]);
  const matched = tx.matchedInvoiceId ? invoices.find((i) => i.id === tx.matchedInvoiceId) : undefined;
  const amount = Number(tx.amount);
  const candidates = tx.status === 'unmatched' && amount > 0 ? rankCandidates(tx, invoices).slice(0, 8) : [];

  const facts: [string, string | null][] = [
    [t('columns.date'), formatDate(tx.transactionDate, locale)],
    [t('columns.variableSymbol'), tx.variableSymbol],
    [t('detail.account'), tx.counterpartyAccount],
    [t('detail.message'), tx.message ?? null],
    [t('detail.importFile'), tx.import.filename],
    [t('detail.importedAt'), formatDate(tx.import.importedAt, locale)]
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/bank" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        {t('detail.backToList')}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex h-11 w-11 items-center justify-center rounded-full',
              amount < 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'
            )}
          >
            {amount < 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight tabular-nums">
              {amount > 0 && '+'}
              {formatMoney(amount, tx.currency, locale)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {tx.counterpartyName ?? t('unknownCounterparty')}
              {tx.fee && Number(tx.fee) > 0 && <span className="ml-2">· {t('fee', { amount: formatMoney(Number(tx.fee), tx.currency, locale) })}</span>}
            </p>
          </div>
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', TX_STATUS_CLASSES[tx.status])}>{t(`status.${tx.status}`)}</span>
        </div>
        <TransactionActions id={tx.id} status={tx.status} />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-4">
          {tx.status === 'matched' && (
            <section className="rounded-xl border border-success/40 bg-success/5 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-success">{t('detail.matchedTo')}</h2>
              {matched ? (
                <Link href={`/invoices/${matched.id}`} className="mt-2 flex items-center gap-3 rounded-lg p-2 hover:bg-card">
                  <FileText className="h-5 w-5 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{matched.invoiceNumber ?? t('detail.draft')}</div>
                    <div className="text-xs text-muted-foreground">{matched.contactName}</div>
                  </div>
                  <span className="font-semibold tabular-nums">{formatMoney(matched.total, matched.currency, locale)}</span>
                </Link>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{t('detail.invoiceGone')}</p>
              )}
            </section>
          )}

          {tx.status === 'unmatched' && amount > 0 && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-bold">{t('detail.suggestions')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('detail.suggestionsHint')}</p>
              {candidates.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{t('detail.noCandidates')}</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {candidates.map(({ invoice, reasons }) => (
                    <li key={invoice.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Link href={`/invoices/${invoice.id}`} className="font-semibold hover:text-primary">
                          {invoice.invoiceNumber}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">
                          {invoice.contactName} · {t('detail.due')} {formatDate(invoice.dueDate, locale) ?? '–'}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {reasons.map((r) => (
                            <span key={r} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                              {t(`detail.reason.${r}`)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className="font-semibold tabular-nums">{formatMoney(invoice.total, invoice.currency, locale)}</span>
                      <TransactionActions id={tx.id} status={tx.status} matchInvoiceId={invoice.id} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tx.status === 'unmatched' && amount < 0 && <Banner tone="info">{t('detail.outgoingHint')}</Banner>}
          {tx.status === 'ignored' && <Banner tone="info">{t('detail.ignoredHint')}</Banner>}
        </div>

        <aside className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('detail.facts')}</h2>
          <dl className="mt-3 space-y-2.5">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-all font-semibold">{value ?? '–'}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
