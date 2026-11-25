/** Shapes and helpers shared by the bank list and transaction detail. */

import type { InvoiceRow } from './invoice-ui';

export type TransactionStatus = 'unmatched' | 'matched' | 'ignored';
export const TRANSACTION_STATUSES: TransactionStatus[] = ['unmatched', 'matched', 'ignored'];

/** A row of `GET /api/v1/bank-reconciliation/transactions` (Drizzle camelCase; numeric as string). */
export interface BankTransaction {
  id: string;
  importId: string;
  transactionDate: string;
  amount: string;
  currency: string;
  variableSymbol: string | null;
  counterpartyAccount: string | null;
  counterpartyName: string | null;
  /** "Zpráva pro příjemce" from the bank, when the source carries it. */
  message?: string | null;
  /** Fee the payment provider kept (PayPal), in `currency`; null for bank rows. */
  fee?: string | null;
  /** What PayPal credited after converting the payment, in `netCurrency`; null when it stayed in `currency`. */
  netAmount?: string | null;
  netCurrency?: string | null;
  matchedInvoiceId: string | null;
  /** Expense a bank rule drafted from this outgoing payment. */
  matchedExpenseId?: string | null;
  /** Bank rule that ignored the payment or drafted its document; cleared by a manual match or restore. */
  appliedRuleId?: string | null;
  status: TransactionStatus;
  createdAt: string;
  /** The list endpoint adds the statement import this row came from. */
  importSource?: string;
  importFilename?: string;
}

export interface BankTransactionDetail extends BankTransaction {
  import: { id: string; filename: string; source: string; importedAt: string };
}

/**
 * The "Příchozí / Odchozí" sums in the home currency. A foreign payment that
 * PayPal converted to the home currency counts with what was credited, so a
 * USD sale shows up in the CZK total; other foreign rows stay out.
 */
export function homeCurrencyTotals(transactions: BankTransaction[], home: string): { incoming: number; outgoing: number } {
  let incoming = 0;
  let outgoing = 0;
  for (const tx of transactions) {
    const value =
      tx.currency === home ? Number(tx.amount) : tx.netCurrency === home && tx.netAmount ? Math.sign(Number(tx.amount)) * Number(tx.netAmount) : 0;
    if (value > 0) incoming += value;
    else outgoing += value;
  }
  return { incoming, outgoing };
}

export const TX_STATUS_CLASSES: Record<TransactionStatus, string> = {
  unmatched: 'bg-warning/15 text-warning',
  matched: 'bg-success/15 text-success',
  ignored: 'bg-muted text-muted-foreground'
};

export interface MatchCandidate {
  invoice: InvoiceRow;
  /** Why it is suggested — strongest reason first. */
  reasons: ('vs' | 'email' | 'amount' | 'name' | 'date')[];
  score: number;
  /** Already paid (e.g. imported history): matching only links it and the invoice stays as it is. */
  paid: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Same window as the backend's paid-invoice tier (matching.ts PAID_LINK_WINDOW_DAYS). */
const PAID_DATE_WINDOW_DAYS = 7;

/**
 * Invoices a payment could belong to, best first. Issued ones mirror the
 * backend's auto-match signals (variable symbol, then exact amount) plus a
 * loose counterparty-name hint. Paid ones that no payment links to yet are
 * offered too when the payer's e-mail, name or amount fits, closer dates
 * first, so imported history can be linked by hand.
 */
export function rankCandidates(
  tx: BankTransaction,
  invoices: InvoiceRow[],
  context: { contactEmails?: Map<string, string>; linkedInvoiceIds?: Set<string> } = {}
): MatchCandidate[] {
  const amount = Number(tx.amount);
  const name = tx.counterpartyName?.toLowerCase().split(/s+/)[0] ?? '';
  const email = tx.counterpartyAccount?.includes('@') ? tx.counterpartyAccount.trim().toLowerCase() : '';
  const txDay = Date.parse(tx.transactionDate.slice(0, 10));
  return invoices
    .filter((i) => i.documentType !== 'quote' && i.currency === tx.currency)
    .filter((i) => i.status === 'issued' || (i.status === 'paid' && !context.linkedInvoiceIds?.has(i.id)))
    .map((invoice) => {
      const paid = invoice.status === 'paid';
      const reasons: MatchCandidate['reasons'] = [];
      if (!paid && tx.variableSymbol && invoice.variableSymbol === tx.variableSymbol) reasons.push('vs');
      const contactEmail = invoice.contactId ? context.contactEmails?.get(invoice.contactId) : undefined;
      if (email && contactEmail?.trim().toLowerCase() === email) reasons.push('email');
      if (Math.abs(invoice.total - amount) < 0.01) reasons.push('amount');
      if (name.length > 2 && invoice.contactName?.toLowerCase().includes(name)) reasons.push('name');
      let closeness = 0;
      if (paid) {
        const days = [invoice.paidAt, invoice.issueDate]
          .filter((d): d is string => Boolean(d))
          .map((d) => Math.abs(Date.parse(d.slice(0, 10)) - txDay) / DAY_MS);
        const closest = days.length ? Math.min(...days) : Infinity;
        if (closest <= PAID_DATE_WINDOW_DAYS) {
          reasons.push('date');
          closeness = PAID_DATE_WINDOW_DAYS + 1 - closest;
        }
      }
      const score =
        (reasons.includes('vs') ? 100 : 0) +
        (reasons.includes('email') ? 60 : 0) +
        (reasons.includes('amount') ? 50 : 0) +
        (reasons.includes('name') ? 20 : 0) +
        closeness * 2;
      return { invoice, reasons, score, paid };
    })
    // A paid invoice is only worth offering when the payer or the amount fits.
    .filter((c) => !c.paid || c.reasons.some((r) => r === 'email' || r === 'name' || r === 'amount'))
    .sort((a, b) => b.score - a.score || (b.invoice.issueDate ?? '').localeCompare(a.invoice.issueDate ?? ''));
}

/** The bits of a bank connection that tell which import it filled. */
export interface SourceConnection {
  id: string;
  provider: 'fio' | 'enable_banking' | 'paypal';
  label: string | null;
  accountNumber: string | null;
  bankName: string | null;
}

const UPLOAD_SOURCES = new Set(['csv', 'camt053', 'gpc', 'mt940']);
const PROVIDER_OF: Record<string, SourceConnection['provider']> = { paypal: 'paypal', fio: 'fio', psd2: 'enable_banking' };
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The title the backend gives a synced import (bank-connections.service.ts:
 * "PayPal 2026-01-01 – …", "Fio 123/2010 2026-…", "<bank> <account> …").
 * An import has no connection id, so with two accounts of one provider this
 * prefix is what tells them apart.
 */
function importPrefix(c: SourceConnection): string {
  if (c.provider === 'paypal') return squash(c.label ?? 'PayPal');
  if (c.provider === 'fio') return squash(`Fio ${c.accountNumber ?? ''}`);
  return squash(`${c.bankName ?? 'Banka'} ${c.accountNumber ?? ''}`);
}

/**
 * Filter key of a transaction: `upload` for an uploaded statement,
 * `c:<connection id>` for a synced one, or the bare source (`paypal`, `fio`,
 * `psd2`) when its connection is gone or can't be told apart.
 */
export function transactionSourceKey(tx: BankTransaction, connections: SourceConnection[]): string {
  const source = tx.importSource ?? '';
  if (UPLOAD_SOURCES.has(source)) return 'upload';
  const provider = PROVIDER_OF[source];
  if (!provider) return source || 'upload';
  const same = connections.filter((c) => c.provider === provider);
  if (same.length === 1) return `c:${same[0]!.id}`;
  const filename = squash(tx.importFilename ?? '');
  const hit = same.find((c) => filename.startsWith(`${importPrefix(c)} `));
  return hit ? `c:${hit.id}` : source;
}

export function connectionLabel(c: SourceConnection): string {
  if (c.label) return c.label;
  if (c.provider === 'paypal') return 'PayPal';
  if (c.provider === 'fio') return squash(`Fio ${c.accountNumber ?? ''}`);
  return squash(`${c.bankName ?? ''} ${c.accountNumber ?? ''}`) || 'PSD2';
}

/** The period presets offered on /bank; the labels come from the reports period picker. */
export const BANK_PERIODS = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'lastYear'] as const;
export type BankPeriod = (typeof BANK_PERIODS)[number];

export type BankDirection = 'in' | 'out';

export interface BankListFilters {
  status?: TransactionStatus;
  q?: string;
  /** A `transactionSourceKey` value. */
  source?: string;
  /** Inclusive YYYY-MM-DD bounds on the transaction date. */
  from?: string;
  to?: string;
  direction?: BankDirection;
}

/** Applies the /bank filters; `skip` leaves some out (the stat cards ignore the status chip). */
export function filterTransactions<T extends BankTransaction & { invoiceNumber?: string | null }>(
  rows: T[],
  filters: BankListFilters,
  connections: SourceConnection[],
  skip: (keyof BankListFilters)[] = []
): T[] {
  const f = { ...filters };
  for (const key of skip) delete f[key];
  return rows.filter((r) => {
    if (f.status && r.status !== f.status) return false;
    const day = r.transactionDate.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    const amount = Number(r.amount);
    if (f.direction === 'in' && !(amount > 0)) return false;
    if (f.direction === 'out' && !(amount < 0)) return false;
    if (f.source && transactionSourceKey(r, connections) !== f.source) return false;
    if (f.q && ![r.counterpartyName, r.variableSymbol, r.counterpartyAccount, r.invoiceNumber].some((v) => v?.toLowerCase().includes(f.q!))) return false;
    return true;
  });
}
