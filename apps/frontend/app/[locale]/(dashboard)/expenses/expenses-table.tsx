'use client';

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { SortHeader, useListSort } from '@/components/sort-header';
import { toast } from '@/components/toaster';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { EXPENSE_STATE_CLASSES, expenseState, isKnownCategory, vatOfGross, type Expense } from '@/lib/expense-ui';
import { cn } from '@/lib/utils';
import { deleteExpense, setExpensePaid } from './actions';

const SORTABLE = ['date', 'supplier', 'description', 'category', 'dueDate', 'amount', 'state'] as const;
type SortKey = (typeof SORTABLE)[number];
const STATE_ORDER = { overdue: 0, unpaid: 1, paid: 2 } as const;

function sortValue(e: Expense, key: SortKey) {
  switch (key) {
    case 'date':
      return e.expenseDate;
    case 'supplier':
      return e.supplierNameRaw;
    case 'description':
      return e.description;
    case 'category':
      return e.category;
    case 'dueDate':
      return e.dueDate;
    case 'amount':
      return Number(e.amount);
    case 'state':
      return STATE_ORDER[expenseState(e)];
  }
}

/** Clickable expense list with multi-select bulk actions and a per-currency sum. */
export function ExpensesTable({ rows, filtered }: { rows: Expense[]; filtered: boolean }) {
  const t = useTranslations('expenses');
  const tList = useTranslations('invoices');
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const { sort, cycle, sorted } = useListSort('billanta:expenses:sort', SORTABLE, rows, sortValue, ['amount']);

  const sums = useMemo(() => {
    const by = new Map<string, { total: number; vat: number }>();
    for (const e of rows) {
      const s = by.get(e.currency) ?? { total: 0, vat: 0 };
      s.total += Number(e.amount);
      s.vat += vatOfGross(Number(e.amount), Number(e.vatRate));
      by.set(e.currency, s);
    }
    return [...by.entries()];
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
        {filtered ? t('emptyFiltered') : t('empty')}
        {!filtered && (
          <div className="mt-3">
            <Link href="/expenses/new" className="font-semibold text-primary hover:underline">
              {t('newExpense')}
            </Link>
          </div>
        )}
      </div>
    );
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = selected.size === rows.length;

  const bulk = (fn: (id: string) => Promise<{ ok: boolean }>, ids: string[]) =>
    startTransition(async () => {
      const results = await Promise.all(ids.map(fn));
      const ok = results.filter((r) => r.ok).length;
      toast({
        text: t('bulkDone', { ok, total: ids.length }),
        tone: ok === ids.length ? 'ok' : 'err'
      });
      setSelected(new Set());
      router.refresh();
    });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-5">
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-semibold">{t('selected', { count: selected.size })}</span>
          <button
            type="button"
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground disabled:opacity-50"
            onClick={() =>
              bulk(
                (id) => setExpensePaid(id, today),
                [...selected].filter((id) => !rows.find((r) => r.id === id)?.paidAt)
              )
            }
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('detail.markPaid')}
          </button>
          <button
            type="button"
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-full border border-destructive/40 px-3 py-1 text-xs font-bold text-destructive disabled:opacity-50"
            onClick={() => {
              if (window.confirm(t('bulkDeleteConfirm', { count: selected.size }))) bulk(deleteExpense, [...selected]);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('detail.delete')}
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
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              {SORTABLE.map((key) => (
                <SortHeader
                  key={key}
                  column={key}
                  label={t(`columns.${key}`)}
                  sort={sort}
                  onSort={cycle}
                  title={tList('view.sortBy')}
                  align={key === 'amount' ? 'right' : 'left'}
                  className={key === 'state' ? 'px-3' : undefined}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const state = expenseState(e);
              return (
                <tr
                  key={e.id}
                  onClick={() => router.push(`/expenses/${e.id}`)}
                  className={cn('cursor-pointer border-b border-border/60 last:border-b-0 hover:bg-accent/60', selected.has(e.id) && 'bg-primary/5')}
                >
                  <td className="px-3 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">{formatDate(e.expenseDate, locale)}</td>
                  <td className="px-2 py-2.5 font-semibold">
                    <Link href={`/expenses/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="hover:text-primary">
                      {e.supplierNameRaw ?? '–'}
                    </Link>
                    {e.documentNumber && <div className="text-xs font-normal text-muted-foreground">{e.documentNumber}</div>}
                  </td>
                  <td className="max-w-[260px] truncate px-2 py-2.5 text-muted-foreground">{e.description}</td>
                  <td className="px-2 py-2.5 text-muted-foreground">
                    {e.category ? (isKnownCategory(e.category) ? t(`category.${e.category}`) : e.category) : t('uncategorized')}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 tabular-nums text-muted-foreground">{formatDate(e.dueDate, locale) ?? '–'}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums">{formatMoney(Number(e.amount), e.currency, locale)}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', EXPENSE_STATE_CLASSES[state])}>{t(`state.${state}`)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {sums.map(([currency, s]) => (
              <tr key={currency} className="border-t border-border bg-muted/40 text-sm">
                <td colSpan={6} className="px-3 py-2 text-right text-muted-foreground">
                  {t('sumLabel', {
                    count: rows.filter((r) => r.currency === currency).length
                  })}{' '}
                  ·{' '}
                  {t('vatIncluded', {
                    vat: formatMoney(s.vat, currency, locale)
                  })}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-extrabold tabular-nums">{formatMoney(s.total, currency, locale)}</td>
                <td />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
