'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

type TransactionStatus = 'unmatched' | 'matched' | 'ignored';

interface BankTransaction {
  id: string;
  transactionDate: string; // ISO date, e.g. "2026-08-01"
  amount: number;
  currency: string;
  variableSymbol: string | null;
  counterpartyName: string | null;
  status: TransactionStatus;
  matchedInvoiceId: string | null;
}

/**
 * PLACEHOLDER DATA — same convention as `expenses/page.tsx`/`invoices/
 * page.tsx`: a few plausibly-shaped rows so the table/filter/actions below
 * have something real to render. Not real businesses.
 */
const INITIAL_TRANSACTIONS: BankTransaction[] = [
  {
    id: 'txn-1',
    transactionDate: '2026-08-01',
    amount: 24200,
    currency: 'CZK',
    variableSymbol: '20260001',
    counterpartyName: 'Novák Consulting s.r.o.',
    status: 'matched',
    matchedInvoiceId: '2026-0001'
  },
  {
    id: 'txn-2',
    transactionDate: '2026-08-20',
    amount: 8470,
    currency: 'CZK',
    variableSymbol: '20260002',
    counterpartyName: 'Dvořák & Partners s.r.o.',
    status: 'unmatched',
    matchedInvoiceId: null
  },
  {
    id: 'txn-3',
    transactionDate: '2026-08-22',
    amount: -450.5,
    currency: 'CZK',
    variableSymbol: null,
    counterpartyName: 'Vlastní převod mezi účty',
    status: 'ignored',
    matchedInvoiceId: null
  }
];

/**
 * Mirrors the *shape* of `BankReconciliationService`'s real auto-match
 * candidates (`apps/backend/src/bank-reconciliation/matching.ts`) — a stand-
 * in for "issued invoices this tenant could plausibly get paid against",
 * used only so an uploaded CSV has something to demo-match against client-
 * side. The real match is variable-symbol-first with an amount+due-date-
 * window fallback (see the backend README); this demo only implements the
 * variable-symbol path, which is enough to show the concept without
 * reimplementing the backend's full algorithm twice.
 */
const MOCK_ISSUED_INVOICES: { id: string; variableSymbol: string }[] = [
  { id: '2026-0002', variableSymbol: '20260002' },
  { id: '2026-0004', variableSymbol: '20260004' }
];

const STATUS_BADGE_CLASSES: Record<TransactionStatus, string> = {
  unmatched: 'bg-warning/15 text-warning',
  matched: 'bg-success/15 text-success',
  ignored: 'bg-muted text-muted-foreground'
};

type StatusFilter = 'all' | TransactionStatus;

/**
 * Parses the CSV format documented in `apps/backend/README.md` ("Bank
 * reconciliation" -> "Expected CSV format"): a header row naming
 * `date,amount,currency,variable_symbol,counterparty_account,
 * counterparty_name` (any order), one data row per line. This is a small,
 * deliberately simplified client-side mirror of the real parser
 * (`apps/backend/src/bank-reconciliation/csv-parser.ts`) — no quoted-field
 * handling — good enough for this demo's own generated files, NOT a
 * substitute for the backend's validation once this page is wired to the
 * real `POST /api/v1/bank-reconciliation/import` endpoint.
 */
function parseCsvClientSide(text: string): Omit<BankTransaction, 'id' | 'status' | 'matchedInvoiceId'>[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('empty file');
  }

  const header = (lines[0] ?? '').split(',').map((cell) => cell.trim().toLowerCase());
  const required = ['date', 'amount', 'currency'];
  for (const name of required) {
    if (!header.includes(name)) {
      throw new Error(`missing column "${name}"`);
    }
  }

  const dateIdx = header.indexOf('date');
  const amountIdx = header.indexOf('amount');
  const currencyIdx = header.indexOf('currency');
  const vsIdx = header.indexOf('variable_symbol');
  const nameIdx = header.indexOf('counterparty_name');

  return lines.slice(1).map((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const rawDate = cells[dateIdx];
    const rawAmount = cells[amountIdx];
    const rawCurrency = cells[currencyIdx]?.toUpperCase();

    if (!rawDate || Number.isNaN(new Date(rawDate).getTime())) {
      throw new Error(`invalid date on line ${index + 2}`);
    }
    if (rawAmount === undefined || Number.isNaN(Number(rawAmount))) {
      throw new Error(`invalid amount on line ${index + 2}`);
    }
    if (!rawCurrency) {
      throw new Error(`invalid currency on line ${index + 2}`);
    }

    return {
      transactionDate: rawDate,
      amount: Number(rawAmount),
      currency: rawCurrency,
      variableSymbol: vsIdx >= 0 ? cells[vsIdx] || null : null,
      counterpartyName: nameIdx >= 0 ? cells[nameIdx] || null : null
    };
  });
}

/**
 * Bank statement reconciliation UI — file upload + transaction table with
 * a manual "match to invoice" action for the unmatched leftovers.
 *
 * REAL vs. STUBBED, precisely: the upload control, client-side CSV parsing,
 * the table, the status filter, and the manual match/ignore actions below
 * are fully working React state management — nothing is a disabled/fake
 * control. What's stubbed is the network boundary: this never calls the
 * real backend (`apps/backend/src/bank-reconciliation/` —
 * `POST /api/v1/bank-reconciliation/import`,
 * `GET .../transactions`,
 * `POST .../transactions/:id/match`,
 * `POST .../transactions/:id/ignore`). Same reason `expenses/page.tsx` and
 * `settings/channels/link-telegram-button.tsx` mock their network calls:
 * there is no dashboard-side authenticated fetch helper wired up yet (see
 * `apps/frontend/lib/backend-token.ts`'s doc comment — it mints the bearer
 * token but nothing in `app/` calls the backend with it yet). Once that
 * exists, replace `parseCsvClientSide` + the local match/ignore handlers
 * below with real `fetch` calls to those four endpoints.
 */
export function BankReconciliationPanel() {
  const t = useTranslations('bank');
  const locale = useLocale();

  const [transactions, setTransactions] = useState<BankTransaction[]>(INITIAL_TRANSACTIONS);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importState, setImportState] = useState<'idle' | 'importing'>('idle');
  const [importMessage, setImportMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [manualInvoiceId, setManualInvoiceId] = useState('');
  const [manualMatchError, setManualMatchError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);
  const currencyFormatters = useRef(new Map<string, Intl.NumberFormat>());
  const formatAmount = (amount: number, currency: string) => {
    let formatter = currencyFormatters.current.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
      currencyFormatters.current.set(currency, formatter);
    }
    return formatter.format(amount);
  };

  const visibleTransactions =
    statusFilter === 'all' ? transactions : transactions.filter((tx) => tx.status === statusFilter);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setImportMessage(null);
  }

  async function handleImport() {
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setImportMessage({ kind: 'error', text: t('import.invalidFile') });
      return;
    }

    setImportState('importing');
    setImportMessage(null);

    try {
      const text = await selectedFile.text();
      const parsedRows = parseCsvClientSide(text);

      let matchedCount = 0;
      const newTransactions: BankTransaction[] = parsedRows.map((row, index) => {
        const candidates = row.variableSymbol
          ? MOCK_ISSUED_INVOICES.filter((invoice) => invoice.variableSymbol === row.variableSymbol)
          : [];
        const matchedInvoice = candidates.length === 1 ? candidates[0] : undefined;
        if (matchedInvoice) matchedCount += 1;

        return {
          ...row,
          id: `txn-import-${Date.now()}-${index}`,
          status: matchedInvoice ? 'matched' : 'unmatched',
          matchedInvoiceId: matchedInvoice ? matchedInvoice.id : null
        };
      });

      setTransactions((prev) => [...newTransactions, ...prev]);
      setImportMessage({
        kind: 'success',
        text: t('import.success', { total: newTransactions.length, matched: matchedCount })
      });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setImportMessage({ kind: 'error', text: t('import.parseError', { message }) });
    } finally {
      setImportState('idle');
    }
  }

  function handleIgnore(id: string) {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, status: 'ignored' } : tx)));
  }

  function startManualMatch(id: string) {
    setEditingRowId(id);
    setManualInvoiceId('');
    setManualMatchError(null);
  }

  function cancelManualMatch() {
    setEditingRowId(null);
    setManualInvoiceId('');
    setManualMatchError(null);
  }

  function confirmManualMatch(id: string) {
    const trimmed = manualInvoiceId.trim();
    if (!trimmed) {
      setManualMatchError(t('matchForm.required'));
      return;
    }

    setTransactions((prev) =>
      prev.map((tx) => (tx.id === id ? { ...tx, status: 'matched', matchedInvoiceId: trimmed } : tx))
    );
    cancelManualMatch();
  }

  return (
    <div>
      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">{t('import.label')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('import.formatHint')}</p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
          />
          <button
            type="button"
            onClick={handleImport}
            disabled={!selectedFile || importState === 'importing'}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UploadCloud className="h-4 w-4" />
            {importState === 'importing' ? t('import.importing') : t('import.submit')}
          </button>
        </div>

        {importMessage && (
          <p
            className={cn(
              'mt-3 text-sm',
              importMessage.kind === 'success' ? 'text-success' : 'text-destructive'
            )}
          >
            {importMessage.text}
          </p>
        )}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('filterLabel')}</span>
        {(['all', 'unmatched', 'matched', 'ignored'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              statusFilter === filter
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            )}
          >
            {filter === 'all' ? t('filterAll') : t(`status.${filter}`)}
          </button>
        ))}
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('columns.date')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.amount')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.variableSymbol')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.counterparty')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.status')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            )}

            {visibleTransactions.map((tx) => (
              <tr key={tx.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {dateFormatter.format(new Date(tx.transactionDate))}
                </td>
                <td className="px-4 py-3 tabular-nums">{formatAmount(tx.amount, tx.currency)}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{tx.variableSymbol ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{tx.counterpartyName ?? '—'}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      STATUS_BADGE_CLASSES[tx.status]
                    )}
                  >
                    {tx.status === 'matched' && tx.matchedInvoiceId
                      ? t('matchedWithInvoice', { invoiceId: tx.matchedInvoiceId })
                      : t(`status.${tx.status}`)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {tx.status === 'unmatched' &&
                    (editingRowId === tx.id ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={manualInvoiceId}
                            onChange={(event) => setManualInvoiceId(event.target.value)}
                            placeholder={t('matchForm.invoiceIdPlaceholder')}
                            className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => confirmManualMatch(tx.id)}
                            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                          >
                            {t('matchForm.confirm')}
                          </button>
                          <button
                            type="button"
                            onClick={cancelManualMatch}
                            className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                          >
                            {t('matchForm.cancel')}
                          </button>
                        </div>
                        {manualMatchError && <p className="text-xs text-destructive">{manualMatchError}</p>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startManualMatch(tx.id)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                        >
                          {t('matchAction')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleIgnore(tx.id)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                        >
                          {t('ignoreAction')}
                        </button>
                      </div>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
