'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, LockKeyhole } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  documentKeyWrap,
  open,
  sealedBalance,
  suggestSealedMatches,
  unwrapDocumentKey,
  type MatchDocument,
  type PaymentAmounts,
  type SealedMatchSuggestion
} from '@faktur/cz-compliance';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { buttonClass } from '@/lib/ui-classes';
import { addSealedPayment, fetchOpenSealedDocuments, type OpenSealedDocument } from '@/lib/vault/actions';
import { openDocumentAmounts, openPaymentWith, sealPayment } from '@/lib/vault/amounts';
import { useVault } from './vault-provider';

export type MatchableTransaction = {
  id: string;
  amount: number;
  currency: string;
  variableSymbol: string | null;
  transactionDate: string;
  counterpartyName: string | null;
};

type OpenedDoc = { doc: OpenSealedDocument; total: number; payments: PaymentAmounts[]; match: MatchDocument };

/**
 * Bank matching for documents with sealed amounts. The server cannot match
 * them (it knows no sums), so once the key is unlocked this tab opens the
 * open documents, compares them with the unmatched incoming payments and
 * offers suggestions. Nothing is matched until the user confirms one.
 */
export function SealedBankMatches({ transactions }: { transactions: MatchableTransaction[] }) {
  const t = useTranslations('vault.bankMatch');
  const locale = useLocale();
  const router = useRouter();
  const { key, vault, requestUnlock } = useVault();
  const [docs, setDocs] = useState<Map<string, OpenedDoc> | null>(null);
  const [hasSealed, setHasSealed] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!vault || !transactions.length) return;
    let live = true;
    void fetchOpenSealedDocuments().then(async (result) => {
      if (!live || !result.ok) return;
      setHasSealed(result.value.length > 0);
      if (!key) return;
      const opened = new Map<string, OpenedDoc>();
      for (const doc of result.value) {
        try {
          const totals = await openDocumentAmounts(key, doc.encAmounts);
          const payments = await Promise.all(doc.payments.map((c) => openPaymentWith((x) => open(key, x), c)));
          const { remaining } = sealedBalance(totals.totalWithVat, payments);
          opened.set(doc.id, {
            doc,
            total: totals.totalWithVat,
            payments,
            match: { id: doc.id, currency: doc.currency, variableSymbol: doc.variableSymbol, issueDate: doc.issueDate, dueDate: doc.dueDate, remaining }
          });
        } catch {
          // A document this key cannot open is simply not suggested.
        }
      }
      if (live) setDocs(opened);
    });
    return () => {
      live = false;
    };
  }, [key, vault, transactions.length]);

  if (!vault || !hasSealed || !transactions.length) return null;

  if (!key) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm">
        <LockKeyhole className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">{t('locked')}</span>
        <button type="button" onClick={() => void requestUnlock()} className="text-xs font-semibold text-primary hover:underline">
          {t('unlock')}
        </button>
      </div>
    );
  }
  if (!docs) return null;

  const suggestions = suggestSealedMatches(
    transactions.filter((tx) => !done.has(tx.id)),
    [...docs.values()].map((d) => d.match)
  );
  if (!suggestions.length) return null;

  const confirm = async (s: SealedMatchSuggestion, tx: MatchableTransaction) => {
    const target = docs.get(s.invoiceId);
    const wrap = target && documentKeyWrap(target.doc.encAmounts);
    if (!target || !wrap || !key) return;
    setBusy(tx.id);
    try {
      const docKey = await unwrapDocumentKey(key, wrap);
      const payment: PaymentAmounts = { amount: tx.amount, fee: 0, receivedHome: null };
      const next = sealedBalance(target.total, [...target.payments, payment]);
      const result = await addSealedPayment(target.doc.id, {
        encAmount: await sealPayment(docKey, payment),
        paidAt: tx.transactionDate.slice(0, 10),
        bankTransactionId: tx.id,
        state: next.state === 'paid' ? 'paid' : 'partly_paid'
      });
      if (!result.ok) return toast({ text: t('failed'), tone: 'err' });
      setDone((prev) => new Set(prev).add(tx.id));
      toast({ text: t('matched', { number: target.doc.invoiceNumber ?? '' }) });
      router.refresh();
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  const byId = new Map(transactions.map((tx) => [tx.id, tx]));
  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-4 text-sm">
      <h2 className="font-bold">{t('title')}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('hint')}</p>
      <ul className="mt-2 divide-y divide-border">
        {suggestions.map((s) => {
          const tx = byId.get(s.transactionId)!;
          const target = docs.get(s.invoiceId)!;
          return (
            <li key={s.transactionId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="amount font-semibold">{formatMoney(tx.amount, tx.currency, locale)}</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {formatDate(tx.transactionDate, locale)}
                  {tx.counterpartyName ? ` · ${tx.counterpartyName}` : ''}
                  {' → '}
                  {target.doc.invoiceNumber ?? '–'} · {t(`reason.${s.reason}`)}
                  {s.ambiguous ? ` · ${t('ambiguous')}` : ''}
                </span>
              </span>
              <button type="button" disabled={busy != null} onClick={() => void confirm(s, tx)} className={buttonClass.secondary}>
                {busy === tx.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                {t('confirm')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
