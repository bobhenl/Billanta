'use client';

import { useMemo, useState, useTransition } from 'react';
import { FileText, Pencil, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ColorDot } from '@/components/color-dot';
import { InfoHint } from '@/components/info-hint';
import { SortHeader, useListSort } from '@/components/sort-header';
import { toast } from '@/components/toaster';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { ENTRY_STATE_CLASSES, entryState, formatMinutes, type Project, type TimeEntry } from '@/lib/time-ui';
import { cn } from '@/lib/utils';
import { deleteEntry, invoiceEntries } from './actions';
import { EntryModal } from './entry-modal';

const SORTABLE = ['date', 'description', 'project', 'contact', 'duration', 'amount', 'state'] as const;
type SortKey = (typeof SORTABLE)[number];
const STATE_ORDER = { unbilled: 0, nonbillable: 1, billed: 2 } as const;
const GROUPS = ['project', 'day', 'entry'] as const;

function sortValue(e: TimeEntry, key: SortKey) {
  switch (key) {
    case 'date':
      return e.startedAt;
    case 'description':
      return e.description;
    case 'project':
      return e.projectName;
    case 'contact':
      return e.contactName;
    case 'duration':
      return e.minutes;
    case 'amount':
      return e.amount ?? null;
    case 'state':
      return STATE_ORDER[entryState(e)];
  }
}

/** Finished entries: sort, pick the unbilled ones and turn them into a draft invoice. */
export function EntriesTable({
  rows,
  projects,
  contacts,
  filtered
}: {
  rows: TimeEntry[];
  projects: Project[];
  contacts: { id: string; name: string }[];
  filtered: boolean;
}) {
  const t = useTranslations('time');
  const tList = useTranslations('invoices');
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<(typeof GROUPS)[number]>('project');
  const [contactId, setContactId] = useState('');
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [pending, startTransition] = useTransition();
  const { sort, cycle, sorted } = useListSort('billanta:time:sort', SORTABLE, rows, sortValue, ['duration', 'amount']);

  const sums = useMemo(() => {
    const minutes = rows.reduce((acc, e) => acc + e.minutes, 0);
    const by = new Map<string, number>();
    for (const e of rows) if (e.amount) by.set(e.currency ?? 'CZK', (by.get(e.currency ?? 'CZK') ?? 0) + e.amount);
    return { minutes, amounts: [...by.entries()] };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
        {filtered ? t('emptyFiltered') : t('empty')}
      </div>
    );
  }

  const selectable = rows.filter((e) => entryState(e) === 'unbilled');
  const picked = rows.filter((e) => selected.has(e.id));
  const pickedContacts = new Set(picked.map((e) => e.contactId).filter(Boolean));
  const pickedCurrencies = new Set(picked.map((e) => e.currency ?? 'CZK'));
  const needsContact = picked.length > 0 && pickedContacts.size === 0;
  const conflict = pickedContacts.size > 1 ? t('invoice.manyContacts') : pickedCurrencies.size > 1 ? t('invoice.manyCurrencies') : null;
  const pickedMinutes = picked.reduce((acc, e) => acc + e.minutes, 0);
  const pickedAmount = picked.reduce((acc, e) => acc + (e.amount ?? 0), 0);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id));

  const invoice = () =>
    startTransition(async () => {
      const r = await invoiceEntries([...selected], groupBy, needsContact ? contactId : undefined);
      if (!r.ok) {
        toast({ text: r.error, tone: 'err' });
        return;
      }
      toast({ text: t('invoice.done'), tone: 'ok' });
      setSelected(new Set());
      router.push(`/invoices/${r.data.id}`);
    });

  const remove = (e: TimeEntry) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    startTransition(async () => {
      const r = await deleteEntry(e.id);
      toast(r.ok ? { text: t('deleted'), tone: 'ok' } : { text: r.error, tone: 'err' });
      router.refresh();
    });
  };

  const stateBadge = (e: TimeEntry) => {
    const state = entryState(e);
    return state === 'billed' && e.invoiceId ? (
      <Link
        href={`/invoices/${e.invoiceId}`}
        onClick={(ev) => ev.stopPropagation()}
        className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold hover:underline', ENTRY_STATE_CLASSES[state])}
      >
        <FileText className="h-3 w-3" />
        {e.invoiceNumber ?? t('draft')}
      </Link>
    ) : (
      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', ENTRY_STATE_CLASSES[state])}>{t(`state.${state}`)}</span>
    );
  };

  const rowActions = (e: TimeEntry) =>
    !e.invoiceId && (
      <div className="flex justify-end gap-0.5">
        <button type="button" onClick={() => setEditing(e)} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-primary" aria-label={t('editEntry')}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => remove(e)} className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={t('delete')}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );

  const money = (e: TimeEntry) => (e.amount != null ? formatMoney(e.amount, e.currency ?? 'CZK', locale) : '–');

  return (
    <div className="mt-5">
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card px-3 py-2 text-sm shadow-sm">
          <span className="font-semibold">
            {t('selected', { count: selected.size })} · {formatMinutes(pickedMinutes)} h
            {pickedAmount > 0 && <> · {formatMoney(pickedAmount, [...pickedCurrencies][0] ?? 'CZK', locale)}</>}
          </span>
          <InfoHint hint={t('invoice.groupHint')} className="text-xs text-muted-foreground">
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as (typeof GROUPS)[number])}
              aria-label={t('invoice.groupBy')}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            >
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t(`invoice.group.${g}`)}
                </option>
              ))}
            </select>
          </InfoHint>
          {needsContact && (
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              aria-label={t('columns.contact')}
              className="h-8 max-w-[12rem] rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="">{t('invoice.pickContact')}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={pending || !!conflict || (needsContact && !contactId)}
            title={conflict ?? undefined}
            onClick={invoice}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            {t('invoice.action')}
          </button>
          {conflict && <span className="text-xs text-destructive">{conflict}</span>}
          <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-primary" onClick={() => setSelected(new Set())}>
            {t('clearSelection')}
          </button>
        </div>
      )}

      {/* Phones: cards. */}
      <ul className="space-y-2 sm:hidden">
        {sorted.map((e) => {
          const canPick = entryState(e) === 'unbilled';
          return (
            <li key={e.id} className={cn('rounded-xl border border-border bg-card p-3', selected.has(e.id) && 'border-primary/50 bg-primary/5')}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary disabled:opacity-30"
                  disabled={!canPick}
                  checked={selected.has(e.id)}
                  onChange={() => toggle(e.id)}
                  aria-label={t('select')}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.description || t('noDescription')}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {e.projectName && <ColorDot color={e.projectColor} />}
                    {[e.projectName, e.contactName].filter(Boolean).join(' · ') || t('noProject')}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{formatDate(e.startedAt, locale)}</span>
                    {stateBadge(e)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold tabular-nums">{formatMinutes(e.minutes)}</div>
                  <div className="text-xs tabular-nums text-muted-foreground">{money(e)}</div>
                  {rowActions(e)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={t('selectAll')}
                  className="h-4 w-4 accent-primary"
                  disabled={selectable.length === 0}
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))}
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
                  align={key === 'amount' || key === 'duration' ? 'right' : 'left'}
                />
              ))}
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const canPick = entryState(e) === 'unbilled';
              return (
                <tr
                  key={e.id}
                  onClick={() => canPick && toggle(e.id)}
                  className={cn('border-b border-border/60 last:border-b-0 hover:bg-accent/60', canPick && 'cursor-pointer', selected.has(e.id) && 'bg-primary/5')}
                >
                  <td className="px-3 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary disabled:opacity-30"
                      disabled={!canPick}
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      aria-label={t('select')}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">{formatDate(e.startedAt, locale)}</td>
                  <td className="max-w-[260px] truncate px-2 py-2.5 font-semibold">{e.description || <span className="font-normal text-muted-foreground">{t('noDescription')}</span>}</td>
                  <td className="px-2 py-2.5">
                    {e.projectName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <ColorDot color={e.projectColor} />
                        {e.projectName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </td>
                  <td className="max-w-[180px] truncate px-2 py-2.5 text-muted-foreground">{e.contactName ?? '–'}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono font-semibold tabular-nums">{formatMinutes(e.minutes)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                    {money(e)}
                    {e.rate != null && <div className="text-xs text-muted-foreground">{formatMoney(e.rate, e.currency ?? 'CZK', locale)}/h</div>}
                  </td>
                  <td className="px-2 py-2.5">{stateBadge(e)}</td>
                  <td className="px-2 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                    {rowActions(e)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/40 text-sm">
              <td colSpan={5} className="px-3 py-2 text-right text-muted-foreground">
                {t('sumLabel', { count: rows.length })}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right font-mono font-extrabold tabular-nums">{formatMinutes(sums.minutes)}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right font-extrabold tabular-nums">
                {sums.amounts.map(([c, a]) => (
                  <div key={c}>{formatMoney(a, c, locale)}</div>
                ))}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-right text-xs text-muted-foreground sm:hidden">
        {t('sumLabel', { count: rows.length })} · {formatMinutes(sums.minutes)} h
        {sums.amounts.map(([c, a]) => ` · ${formatMoney(a, c, locale)}`).join('')}
      </p>

      <EntryModal open={!!editing} onClose={() => setEditing(null)} projects={projects.filter((p) => !p.archived || p.id === editing?.projectId)} entry={editing} />
    </div>
  );
}
