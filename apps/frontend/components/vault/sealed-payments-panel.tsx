'use client';

import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Loader2, Trash2, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { documentKeyWrap, open, sealedBalance, unwrapDocumentKey, type PaymentAmounts, type SealedBalance } from '@faktur/cz-compliance';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import {
  addSealedPayment,
  deleteSealedPayment,
  fetchCardPaymentsToSeal,
  fetchSealedPayments,
  setSealedCardAmount,
  type CardPaymentToSeal,
  type SealedPaymentRow
} from '@/lib/vault/actions';
import { openDocumentAmounts, openPaymentWith, sealPayment } from '@/lib/vault/amounts';
import { cardPaymentAmounts, sealCardPayments } from '@/lib/vault/card-payments';
import { useVault } from './vault-provider';

type Opened = { row: SealedPaymentRow; amounts: PaymentAmounts };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Payments of a document with sealed amounts. The server stores each sum as
 * an envelope under the document key, so the list, the rest due and the
 * paid/partly paid verdict all come from this tab once the key is unlocked.
 */
export function SealedPaymentsPanel({
  invoiceId,
  encAmounts,
  currency,
  status,
  cardAmount,
  cardsEnabled,
  canEdit
}: {
  invoiceId: string;
  encAmounts: string;
  currency: string;
  status: string;
  cardAmount: number | null;
  cardsEnabled: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations('vault.payments');
  const locale = useLocale();
  const router = useRouter();
  const { key, requestUnlock } = useVault();
  const [total, setTotal] = useState<number | null>(null);
  const [payments, setPayments] = useState<Opened[] | null>(null);
  // Card payments the server still holds in plain; sealed here on opening when the member may edit.
  const [waiting, setWaiting] = useState<CardPaymentToSeal[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [paidAt, setPaidAt] = useState(today);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const totals = await openDocumentAmounts(key, encAmounts);
      let card = await fetchCardPaymentsToSeal(invoiceId);
      if (canEdit && card.ok && card.value.length) {
        const { sealed } = await sealCardPayments(key, card.value);
        if (sealed) {
          card = await fetchCardPaymentsToSeal(invoiceId);
          router.refresh();
        }
      }
      const rows = await fetchSealedPayments(invoiceId);
      if (!rows.ok) throw new Error(rows.error);
      const opened = await Promise.all(rows.value.map(async (row) => ({ row, amounts: await openPaymentWith((c) => open(key, c), row.encAmount) })));
      setTotal(totals.totalWithVat);
      setPayments(opened);
      setWaiting(card.ok ? card.value : []);
      setFailed(false);
    } catch {
      // One envelope this key cannot open would make the rest due wrong, so nothing is shown.
      setFailed(true);
    }
  }, [key, encAmounts, invoiceId, canEdit, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (n: number) => formatMoney(n, currency, locale);
  // A card payment still waiting to be sealed counts like any other.
  const counted = payments ? [...payments.map((p) => p.amounts), ...waiting.map(cardPaymentAmounts)] : null;
  const balance: SealedBalance | null = total != null && counted ? sealedBalance(total, counted) : null;

  useEffect(() => {
    if (balance && !amount) setAmount(balance.remaining > 0 ? String(balance.remaining) : '');
    // Only the first opening fills the field; later the user's input stays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance?.remaining]);

  if (status !== 'issued' && status !== 'paid') return null;

  if (!key || failed || !balance || !payments) {
    return (
      <section className="mt-3 rounded-xl border border-border bg-card p-4 text-sm">
        <h2 className="flex items-center gap-2 font-bold">
          <Wallet className="h-4 w-4" aria-hidden="true" />
          {t('title')}
        </h2>
        <p className="mt-1 text-muted-foreground">{failed ? t('otherKey') : t('locked')}</p>
        {!key && (
          <button type="button" onClick={() => void requestUnlock()} className={`${buttonClass.secondary} mt-2`}>
            {t('unlock')}
          </button>
        )}
      </section>
    );
  }

  const add = async () => {
    const value = Number(amount.replace(',', '.'));
    const feeValue = fee ? Number(fee.replace(',', '.')) : 0;
    if (!(value > 0) || !(feeValue >= 0)) return toast({ text: t('invalid'), tone: 'err' });
    setBusy(true);
    try {
      const wrap = documentKeyWrap(encAmounts);
      if (!wrap) throw new Error('document_key_missing');
      const docKey = await unwrapDocumentKey(key, wrap);
      const payment: PaymentAmounts = { amount: value, fee: feeValue, receivedHome: null };
      const next = sealedBalance(total!, [...(counted ?? []), payment]);
      const result = await addSealedPayment(invoiceId, {
        encAmount: await sealPayment(docKey, payment),
        paidAt,
        state: next.state === 'paid' ? 'paid' : 'partly_paid'
      });
      if (!result.ok) return toast({ text: t('failed'), tone: 'err' });
      toast({ text: next.state === 'paid' ? t('paidInFull') : t('added') });
      setAmount('');
      setFee('');
      await load();
      router.refresh();
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return;
    setBusy(true);
    const left = payments.filter((p) => p.row.id !== id).map((p) => p.amounts);
    const result = await deleteSealedPayment(invoiceId, id, sealedBalance(total!, left).state);
    setBusy(false);
    if (!result.ok) return toast({ text: t('failed'), tone: 'err' });
    await load();
    router.refresh();
  };

  // The one plain number of a sealed document, stored only when the user asks for card payment.
  const toggleCard = async (on: boolean) => {
    setBusy(true);
    const result = await setSealedCardAmount(invoiceId, on ? balance.remaining : null);
    setBusy(false);
    if (!result.ok) return toast({ text: t('failed'), tone: 'err' });
    router.refresh();
  };

  const total2 = total!;
  // Marked paid in full (by hand or by card) without a sealed payment for the sum: nothing is left either way.
  const left = status === 'paid' ? 0 : balance.remaining;
  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-4 text-sm">
      <h2 className="flex items-center gap-2 font-bold">
        <Wallet className="h-4 w-4" aria-hidden="true" />
        {t('title')}
      </h2>
      <p className="mt-1">
        <span className="font-semibold text-success">
          <span className="amount">{t('paid', { amount: money(balance.paid) })}</span>
        </span>
        <span className="text-muted-foreground">
          {' · '}
          <span className="amount">{t('remaining', { amount: money(left), total: money(total2) })}</span>
        </span>
      </p>

      {payments.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {payments.map(({ row, amounts }) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                <span className="amount font-semibold">{money(amounts.amount)}</span>
                {amounts.fee > 0 && <span className="text-muted-foreground"> · {t('feeShort', { amount: money(amounts.fee) })}</span>}
                <span className="text-muted-foreground"> · {row.paidAt ? formatDate(row.paidAt, locale) : t('carried')}</span>
                {row.bankTransactionId && <span className="text-muted-foreground"> · {t('fromBank')}</span>}
              </span>
              {canEdit && (
                <button type="button" disabled={busy} onClick={() => void remove(row.id)} className={buttonClass.ghost} aria-label={t('delete')}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {waiting.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {waiting.map((item) => (
            <li key={item.id} className="py-1.5">
              <span className="amount font-semibold">{money(Number(item.amount))}</span>
              {item.fee != null && Number(item.fee) > 0 && <span className="text-muted-foreground"> · {t('feeShort', { amount: money(Number(item.fee)) })}</span>}
              {item.paidAt && <span className="text-muted-foreground"> · {formatDate(item.paidAt, locale)}</span>}
              <span className="text-muted-foreground"> · {t('cardWaiting')}</span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && left > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t('amount')}</span>
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t('fee')}</span>
            <input className={inputClass} inputMode="decimal" value={fee} placeholder="0" onChange={(e) => setFee(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t('date')}</span>
            <input className={inputClass} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </label>
          <button type="button" disabled={busy} onClick={() => void add()} className={buttonClass.primary}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('add')}
          </button>
        </div>
      )}

      {canEdit && cardsEnabled && status === 'issued' && balance.remaining > 0 && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" disabled={busy} checked={cardAmount != null} onChange={(e) => void toggleCard(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 font-semibold">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                {t('card.label')}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {cardAmount != null ? t('card.on', { amount: money(cardAmount) }) : t('card.hint', { amount: money(balance.remaining) })}
              </span>
            </span>
          </label>
        </div>
      )}
    </section>
  );
}
