'use client';

import { useState, useTransition } from 'react';
import { EyeOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { toast } from '@/components/toaster';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { TX_STATUS_CLASSES, type BankTransaction } from '@/lib/bank-ui';
import { cn } from '@/lib/utils';
import { ignoreTransaction } from './actions';

export type BankRow = BankTransaction & { invoiceNumber: string | null; invoiceContact: string | null };

/** Statement lines: rows open the detail; unmatched ones can be bulk-ignored. */
export function BankTable({ rows, empty }: { rows: BankRow[]; empty: boolean }) {
  const t = useTranslations('bank');
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
        {empty ? t('empty') : t('emptyFiltered')}
      </div>
    );
  }

  const selectable = rows.filter((r) => r.status === 'unmatched');
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkIgnore = () =>
    startTransition(async () => {
      const ids = [...selected];
      const results = await Promise.all(ids.map(ignoreTransaction));
      const ok = results.filter((r) => r.ok).length;
      toast({ text: t('bulkDone', { ok, total: ids.length }), tone: ok === ids.length ? 'ok' : 'err' });
      setSelected(new Set());
      router.refresh();
    });

  return (
    <div className="mt-5">
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-semibold">{t('selected', { count: selected.size })}</span>
          <button
            type="button"
            disabled={pending}
            onClick={bulkIgnore}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-bold disabled:opacity-50"
          >
            <EyeOff className="h-3.5 w-3.5" />
            {t('ignoreAction')}
          </button>
          <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-primary" onClick={() => setSelected(new Set())}>
            {t('clearSelection')}
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={t('selectAll')}
                  className="h-4 w-4 accent-primary"
                  disabled={selectable.length === 0}
                  checked={selectable.length > 0 && selected.size === selectable.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())}
                />
              </th>
              <th className="px-2 py-2.5 font-medium">{t('columns.date')}</th>
              <th className="px-2 py-2.5 font-medium">{t('columns.counterparty')}</th>
              <th className="px-2 py-2.5 font-medium">{t('columns.variableSymbol')}</th>
              <th className="px-2 py-2.5 text-right font-medium">{t('columns.amount')}</th>
              <th className="px-3 py-2.5 font-medium">{t('columns.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tx) => {
              const amount = Number(tx.amount);
              return (
                <tr
                  key={tx.id}
                  onClick={() => router.push(`/bank/${tx.id}`)}
                  className={cn('cursor-pointer border-b border-border/60 last:border-b-0 hover:bg-accent/60', selected.has(tx.id) && 'bg-primary/5')}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {tx.status === 'unmatched' && (
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(tx.id)} onChange={() => toggle(tx.id)} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">{formatDate(tx.transactionDate, locale)}</td>
                  <td className="px-2 py-2.5">
                    <Link href={`/bank/${tx.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-primary">
                      {tx.counterpartyName ?? t('unknownCounterparty')}
                    </Link>
                    {tx.counterpartyAccount && <div className="font-mono text-xs text-muted-foreground">{tx.counterpartyAccount}</div>}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs text-muted-foreground">{tx.variableSymbol ?? '–'}</td>
                  <td className={cn('whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums', amount < 0 ? 'text-destructive' : 'text-success')}>
                    {amount > 0 && '+'}
                    {formatMoney(amount, tx.currency, locale)}
                    {tx.fee && Number(tx.fee) > 0 && (
                      <div className="text-[11px] font-normal text-muted-foreground">
                        {t('fee', { amount: formatMoney(Number(tx.fee), tx.currency, locale) })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', TX_STATUS_CLASSES[tx.status])}>
                      {tx.status === 'matched' && tx.invoiceNumber ? t('matchedWithInvoice', { invoiceId: tx.invoiceNumber }) : t(`status.${tx.status}`)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
