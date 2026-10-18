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
  matchedInvoiceId: string | null;
  status: TransactionStatus;
  createdAt: string;
}

export interface BankTransactionDetail extends BankTransaction {
  import: { id: string; filename: string; source: string; importedAt: string };
}

export const TX_STATUS_CLASSES: Record<TransactionStatus, string> = {
  unmatched: 'bg-warning/15 text-warning',
  matched: 'bg-success/15 text-success',
  ignored: 'bg-muted text-muted-foreground'
};

export interface MatchCandidate {
  invoice: InvoiceRow;
  /** Why it is suggested — strongest reason first. */
  reasons: ('vs' | 'amount' | 'name')[];
  score: number;
}

/**
 * Issued invoices a payment could belong to, best first. Mirrors the
 * backend's auto-match signals (variable symbol, then exact amount) plus a
 * loose counterparty-name hint, so the manual pick starts with the likely one.
 */
export function rankCandidates(tx: BankTransaction, invoices: InvoiceRow[]): MatchCandidate[] {
  const amount = Number(tx.amount);
  const name = tx.counterpartyName?.toLowerCase().split(/\s+/)[0] ?? '';
  return invoices
    .filter((i) => i.status === 'issued' && i.documentType !== 'quote' && i.currency === tx.currency)
    .map((invoice) => {
      const reasons: MatchCandidate['reasons'] = [];
      if (tx.variableSymbol && invoice.variableSymbol === tx.variableSymbol) reasons.push('vs');
      if (Math.abs(invoice.total - amount) < 0.01) reasons.push('amount');
      if (name.length > 2 && invoice.contactName?.toLowerCase().includes(name)) reasons.push('name');
      const score = (reasons.includes('vs') ? 100 : 0) + (reasons.includes('amount') ? 50 : 0) + (reasons.includes('name') ? 20 : 0);
      return { invoice, reasons, score };
    })
    .sort((a, b) => b.score - a.score || (b.invoice.issueDate ?? '').localeCompare(a.invoice.issueDate ?? ''));
}
