'use client';

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, Plus, Receipt, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { SortHeader, useListSort } from '@/components/sort-header';
import { toast } from '@/components/toaster';
import { useCanDo, useCanWrite } from '@/components/access-provider';
import { EmptyState } from '@/components/empty-state';
import { ConfirmModal } from '@/components/modal';
import { LockBadge } from '@/components/record-lock';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { EXPENSE_STATE_CLASSES, expenseState, isKnownCategory, vatOfGross, type Expense } from '@/lib/expense-ui';
import { cn } from '@/lib/utils';
import { buttonClass } from '@/lib/ui-classes';
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  // The checkboxes only feed bulk mark-paid/delete, so read-only gets a plain list.
  const canWriteArea = useCanWrite('expenses');
  const canCreate = useCanDo('expenses.create');
  const canApprove = useCanDo('expenses.approve');
  const canDelete = useCanDo('expenses.delete');
  const canEdit = canWriteArea && (canApprove || canDelete);
  const { sort, cycle, sorted } = useListSort('billanta:expenses:sort', SORTABLE, rows, sortValue, ['amount']);

  const sums = useMemo(() => {
    const by = new Map<string, { total: number; vat: number }>();
    for (const e of rows) {
      const s = by.get(e.currency) ?? { total: 0, vat: 0 };
      s.total += Number(e.amount);
      // Reverse-charge VAT is self-assessed on top of the amount, so none of it is "included".
      if (!e.reverseCharge) s.vat += vatOfGross(Number(e.amount), Number(e.vatRate));
      by.set(e.currency, s);
    }
    return [...by.entries()];
  }, [rows]);

  if (rows.length === 0) {
    return (
      <EmptyState
        className="mt-6"
        icon={Receipt}
        title={filtered ? t('emptyFiltered') : t('empty')}
        action={
          !filtered &&
          canWriteArea &&
          canCreate && (
            <Link href="/expenses/new" className={buttonClass.primary}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('newExpense')}
            </Link>
          )
        }
      />
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
          {canApprove && (
          <button
            type="button"
            disabled={pending}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50"
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
          )}
          {canDelete && (
          <button
            type="button"
            disabled={pending}
            className="ml-2 inline-flex h-9 items-center gap-1 rounded-full border border-destructive/40 px-3 text-xs font-bold text-destructive disabled:opacity-50"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('detail.delete')}
          </button>
          )}
          <button type="button" className="ml-auto h-9 px-2 text-xs text-muted-foreground hover:text-primary" onClick={() => setSelected(new Set())}>
            {t('clearSelection')}
          </button>
        </div>
      )}

      {/* Below md the eight columns cannot fit, so each expense becomes a two-line row. */}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card md:hidden">
        {sorted.map((e) => {
          const state = expenseState(e);
          return (
            <li key={e.id} className={cn('flex items-center gap-3 px-3 py-3', selected.has(e.id) && 'bg-primary/5')}>
              {canEdit && (
                <input
                  type="checkbox"
                  aria-label={e.supplierNameRaw ?? e.description}
                  className="h-5 w-5 shrink-0 accent-primary"
                  checked={selected.has(e.id)}
                  onChange={() => toggle(e.id)}
                />
              )}
              <Link href={`/expenses/${e.id}`} className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="truncate">{e.supplierNameRaw ?? e.description}</span>
                    <LockBadge level={e.accessLock} />
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDate(e.expenseDate, locale)}
                    {e.category && ` · ${isKnownCategory(e.category) ? t(`category.${e.category}`) : e.category}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums"><span className="amount">{formatMoney(Number(e.amount), e.currency, locale)}</span></p>
                  <p className={cn('text-xs font-semibold', state === 'paid' ? 'text-muted-foreground' : state === 'overdue' ? 'text-destructive' : 'text-warning')}>
                    {t(`state.${state}`)}
                  </p>
                  {e.needsReview && <p className="text-xs font-semibold text-primary">{t('needsReview')}</p>}
                </div>
              </Link>
            </li>
          );
        })}
        {sums.map(([currency, s]) => (
          <li key={currency} className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span><span className="amount">{t('vatIncluded', { vat: formatMoney(s.vat, currency, locale) })}</span></span>
            <span className="text-sm font-extrabold tabular-nums text-foreground"><span className="amount">{formatMoney(s.total, currency, locale)}</span></span>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              {canEdit && (
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={t('selectAll')}
                    className="h-4 w-4 accent-primary"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
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
                  {canEdit && (
                    <td className="px-3 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                    </td>
                  )}
                  <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">{formatDate(e.expenseDate, locale)}</td>
                  <td className="px-2 py-2.5 font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      <Link href={`/expenses/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="hover:text-primary">
                        {e.supplierNameRaw ?? '–'}
                      </Link>
                      <LockBadge level={e.accessLock} />
                    </span>
                    {e.documentNumber && <div className="text-xs font-normal text-muted-foreground">{e.documentNumber}</div>}
                  </td>
                  <td className="max-w-[260px] truncate px-2 py-2.5 text-muted-foreground">{e.description}</td>
                  <td className="px-2 py-2.5 text-muted-foreground">
                    {e.category ? (isKnownCategory(e.category) ? t(`category.${e.category}`) : e.category) : t('uncategorized')}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 tabular-nums text-muted-foreground">{formatDate(e.dueDate, locale) ?? '–'}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums"><span className="amount">{formatMoney(Number(e.amount), e.currency, locale)}</span></td>
                  <td className="px-3 py-2.5">
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', EXPENSE_STATE_CLASSES[state])}>{t(`state.${state}`)}</span>
                    {e.needsReview && (
                      <span className="ml-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{t('needsReview')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {sums.map(([currency, s]) => (
              <tr key={currency} className="border-t border-border bg-muted/40 text-sm">
                <td colSpan={canEdit ? 6 : 5} className="px-3 py-2 text-right text-muted-foreground">
                  {t('sumLabel', {
                    count: rows.filter((r) => r.currency === currency).length
                  })}{' '}
                  ·{' '}
                  <span className="amount">{t('vatIncluded', {
                    vat: formatMoney(s.vat, currency, locale)
                  })}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-extrabold tabular-nums"><span className="amount">{formatMoney(s.total, currency, locale)}</span></td>
                <td />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('bulkDeleteTitle', { count: selected.size })}
        body={t('bulkDeleteBody')}
        backLabel={t('detail.back')}
        confirmLabel={t('detail.delete')}
        icon={<Trash2 className="h-4 w-4" />}
        danger
        pending={pending}
        onConfirm={() => {
          setConfirmDelete(false);
          bulk(deleteExpense, [...selected]);
        }}
      />
    </div>
  );
}
