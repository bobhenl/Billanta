'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Repeat2,
  Send,
  Stamp,
  Trash2
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from '@/components/toaster';
import { ColorDot } from '@/components/color-dot';
import {
  CONVERSIONS,
  displayStatus,
  formatDate,
  formatMoney,
  STATUS_BADGE_CLASSES,
  TYPE_BADGE_CLASSES,
  type InvoiceRow
} from '@/lib/invoice-ui';
import { COLUMNS_KEY, INLINE_KEY, readJson, SORT_KEY, VIEW_EVENT, writeJson } from '@/lib/invoice-list-prefs';
import { startNavProgress } from '@/components/nav-progress';
import { cn } from '@/lib/utils';
import {
  cancelInvoice,
  convertInvoice,
  deleteInvoice,
  issueInvoice,
  markInvoicePaid,
  sendInvoice,
  type ActionResult
} from './actions';

const COLUMNS = [
  'number',
  'type',
  'customer',
  'issueDate',
  'dueDate',
  'paidAt',
  'sentAt',
  'variableSymbol',
  'totalWithoutVat',
  'total',
  'status'
] as const;
type Column = (typeof COLUMNS)[number];
const DEFAULT_COLUMNS: Column[] = ['number', 'type', 'customer', 'issueDate', 'dueDate', 'total', 'status'];
const NUMERIC: Column[] = ['totalWithoutVat', 'total'];

/** Sort keys beyond the columns: creation order, days overdue and the balance still due. */
const EXTRA_SORTS = ['createdAt', 'overdue', 'amountDue', 'taxableDate'] as const;
type SortKey = Column | (typeof EXTRA_SORTS)[number];
type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null;
const SORT_KEYS: readonly SortKey[] = [...COLUMNS, ...EXTRA_SORTS];
/** The sort menu (VoxelRank-style), as `key:dir`; '' = the server's order (newest created first). */
const SORT_OPTIONS = [
  'issueDate:desc',
  'issueDate:asc',
  'createdAt:asc',
  'dueDate:asc',
  'dueDate:desc',
  'overdue:desc',
  'total:desc',
  'total:asc',
  'amountDue:desc',
  'totalWithoutVat:desc',
  'customer:asc',
  'customer:desc',
  'number:desc',
  'number:asc',
  'paidAt:desc',
  'sentAt:desc',
  'taxableDate:desc',
  'variableSymbol:asc',
  'status:asc',
  'type:asc'
] as const;

function readColumns(): Column[] {
  const raw = readJson<unknown>(COLUMNS_KEY, null);
  if (Array.isArray(raw)) {
    const cols = raw.filter((c): c is Column => COLUMNS.includes(c as Column));
    if (cols.length) return cols;
  }
  return DEFAULT_COLUMNS;
}

function readSort(): Sort {
  const raw = readJson<Sort>(SORT_KEY, null);
  return raw && SORT_KEYS.includes(raw.key) && (raw.dir === 'asc' || raw.dir === 'desc') ? raw : null;
}

/** What a column sorts by; empty values always go last. */
function sortValue(row: InvoiceRow, key: SortKey): string | number | null {
  switch (key) {
    case 'createdAt':
      return row.createdAt;
    case 'taxableDate':
      return row.taxableSupplyDate;
    case 'overdue':
      return row.isOverdue && row.dueDate ? Date.now() - Date.parse(row.dueDate) : null;
    case 'amountDue':
      return row.status === 'issued' ? row.total - Number(row.amountPaid ?? 0) : null;
    case 'number':
      return row.invoiceNumber;
    case 'type':
      return row.documentType;
    case 'customer':
      return row.contactName;
    case 'issueDate':
      return row.issueDate;
    case 'dueDate':
      return row.dueDate;
    case 'paidAt':
      return row.paidAt;
    case 'sentAt':
      return row.sentAt;
    case 'variableSymbol':
      return row.variableSymbol;
    case 'totalWithoutVat':
      return row.totalWithoutVat;
    case 'total':
      return row.total;
    case 'status':
      return displayStatus(row);
  }
}

/**
 * The invoice list: whole rows open the detail, a "⋯" menu per row carries
 * the state-dependent actions, checkboxes enable bulk actions, and the
 * visible columns are the viewer's choice (remembered in this browser).
 */
export function InvoicesTable({ rows, filtered }: { rows: InvoiceRow[]; filtered: boolean }) {
  const t = useTranslations('doc');
  const tList = useTranslations('invoices');
  const tStatus = useTranslations('invoices.status');
  const tGloss = useTranslations('glossary');
  const locale = useLocale();
  const router = useRouter();
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>(null);
  const [inline, setInline] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Re-read when a saved view is applied (invoice-view-bar.tsx).
    const load = () => {
      setColumns(readColumns());
      setSort(readSort());
      setInline(readJson<boolean>(INLINE_KEY, false) === true);
    };
    load();
    window.addEventListener(VIEW_EVENT, load);
    return () => window.removeEventListener(VIEW_EVENT, load);
  }, []);
  useEffect(() => setSelected(new Set()), [rows]);

  const toggleColumn = (column: Column) => {
    setColumns((current) => {
      const next = current.includes(column) ? current.filter((c) => c !== column) : COLUMNS.filter((c) => c === column || current.includes(c));
      if (next.length === 0) return current;
      writeJson(COLUMNS_KEY, next);
      return next;
    });
  };

  /** A header click cycles: first direction -> the other one -> back to the server's order. */
  const cycleSort = (key: Column) => {
    const first = NUMERIC.includes(key) ? 'desc' : 'asc';
    const next: Sort = sort?.key !== key ? { key, dir: first } : sort.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null;
    setSort(next);
    writeJson(SORT_KEY, next);
  };

  const toggleInline = () => {
    const next = !inline;
    setInline(next);
    writeJson(INLINE_KEY, next);
  };

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * factor;
      return String(x).localeCompare(String(y), locale, { numeric: true }) * factor;
    });
  }, [rows, sort, locale]);

  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.status === 'cancelled' || row.documentType === 'quote') continue;
      map.set(row.currency, (map.get(row.currency) ?? 0) + row.total);
    }
    return [...map.entries()];
  }, [rows]);

  const runBulk = (label: string, ids: string[], fn: (id: string) => Promise<ActionResult<unknown>>) =>
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => fn(id)));
      const failed = results.filter((r) => !r.ok).length;
      toast({
        text: failed ? t('bulkPartial', { ok: ids.length - failed, failed }) : t('bulkDone', { action: label, count: ids.length }),
        tone: failed ? 'err' : 'ok'
      });
      router.refresh();
    });

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const payable = selectedRows.filter((r) => r.status === 'issued' && r.documentType !== 'quote');
  const deletable = selectedRows.filter((r) => r.status === 'draft' || r.status === 'pending_review');

  const cell = (row: InvoiceRow, column: Column) => {
    switch (column) {
      case 'number':
        return <span className="whitespace-nowrap font-mono text-xs font-semibold">{row.invoiceNumber ?? <span className="font-sans font-normal italic text-muted-foreground">{t('unnumbered')}</span>}</span>;
      case 'type':
        return <span title={tGloss(`type.${row.documentType}`)} className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', TYPE_BADGE_CLASSES[row.documentType])}>{t(`type.${row.documentType}`)}</span>;
      case 'customer':
        return (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <ColorDot color={row.contactColor} />
            {row.contactName ?? '–'}
          </span>
        );
      case 'issueDate':
        return <span className="tabular-nums text-muted-foreground">{formatDate(row.issueDate, locale) ?? '–'}</span>;
      case 'dueDate':
        return <span className={cn('tabular-nums', row.isOverdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{formatDate(row.dueDate, locale) ?? '–'}</span>;
      case 'paidAt':
        return <span className="tabular-nums text-muted-foreground">{formatDate(row.paidAt, locale) ?? '–'}</span>;
      case 'sentAt':
        return <span className="tabular-nums text-muted-foreground">{formatDate(row.sentAt, locale) ?? '–'}</span>;
      case 'variableSymbol':
        return <span className="font-mono text-xs text-muted-foreground">{row.variableSymbol ?? '–'}</span>;
      case 'totalWithoutVat':
        return <span className="tabular-nums text-muted-foreground">{formatMoney(row.totalWithoutVat, row.currency, locale)}</span>;
      case 'total':
        return (
          <span className="font-semibold tabular-nums">
            {formatMoney(row.total, row.currency, locale)}
            {row.status === 'issued' && Number(row.amountPaid ?? 0) > 0 && (
              <span className="block text-xs font-medium text-success">{t('partial.short', { amount: formatMoney(Number(row.amountPaid), row.currency, locale) })}</span>
            )}
          </span>
        );
      case 'status': {
        const status = displayStatus(row);
        return (
          <span title={tGloss(`status.${status}`)} className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_BADGE_CLASSES[status])}>
            {status === 'overdue' ? t('overdue') : tStatus(status)}
          </span>
        );
      }
    }
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
          {selected.size > 0 ? (
            <>
              <span className="font-semibold">{t('selected', { count: selected.size })}</span>
              {payable.length > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => runBulk(t('actions.markPaid'), payable.map((r) => r.id), (id) => markInvoicePaid(id))}
                  className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-1.5 font-semibold text-success hover:bg-success/25"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {t('actions.markPaid')} ({payable.length})
                </button>
              )}
              {deletable.length > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(t('confirm.bulkDelete', { count: deletable.length }))) {
                      runBulk(t('actions.delete'), deletable.map((r) => r.id), deleteInvoice);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1.5 font-semibold text-destructive hover:bg-destructive/20"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('actions.delete')} ({deletable.length})
                </button>
              )}
              <button type="button" onClick={() => setSelected(new Set())} className="text-muted-foreground hover:text-primary">
                {t('clearSelection')}
              </button>
            </>
          ) : (
            <span className="text-muted-foreground">{t('count', { count: rows.length })}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
        <label className="relative inline-flex items-center">
          <span className="sr-only">{tList('view.sortLabel')}</span>
          <ArrowUpDown className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" aria-hidden />
          <select
            value={sort ? `${sort.key}:${sort.dir}` : ''}
            onChange={(event) => {
              const [key, dir] = event.target.value.split(':') as [SortKey, 'asc' | 'desc'];
              const next: Sort = event.target.value ? { key, dir } : null;
              setSort(next);
              writeJson(SORT_KEY, next);
            }}
            className="h-9 max-w-[15rem] appearance-none rounded-full border border-border bg-background pl-9 pr-8 text-sm font-semibold text-foreground outline-none hover:bg-accent focus:border-primary"
          >
            <option value="">{tList('view.sort.default')}</option>
            {sort && !(SORT_OPTIONS as readonly string[]).includes(`${sort.key}:${sort.dir}`) && (
              <option value={`${sort.key}:${sort.dir}`}>
                {t(`columns.${sort.key as Column}`)} {sort.dir === 'asc' ? '↑' : '↓'}
              </option>
            )}
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {tList(`view.sort.${option.replace(':', '_')}`)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setChooserOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-semibold hover:bg-accent hover:text-primary"
            aria-expanded={chooserOpen}
          >
            <Columns3 className="h-4 w-4" />
            {t('columnsButton')}
          </button>
          {chooserOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setChooserOpen(false)} />
              <div className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-border bg-card p-2 shadow-lg">
                {COLUMNS.map((column) => (
                  <label key={column} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent">
                    <input type="checkbox" checked={columns.includes(column)} onChange={() => toggleColumn(column)} className="accent-[hsl(var(--primary))]" />
                    {t(`columns.${column}`)}
                  </label>
                ))}
                <div className="mt-1 border-t border-border pt-1">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent" title={tList('view.inlineActionsHint')}>
                    <input type="checkbox" checked={inline} onChange={toggleInline} className="accent-[hsl(var(--primary))]" />
                    {tList('view.inlineActions')}
                  </label>
                  {sort && (
                    <button
                      type="button"
                      onClick={() => {
                        setSort(null);
                        writeJson(SORT_KEY, null);
                      }}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-primary"
                    >
                      {tList('view.resetSort')}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label={t('selectAll')}
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  className="accent-[hsl(var(--primary))]"
                />
              </th>
              {columns.map((column) => {
                const active = sort?.key === column;
                const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('px-3 py-2 font-medium', NUMERIC.includes(column) && 'text-right')}
                  >
                    <button
                      type="button"
                      onClick={() => cycleSort(column)}
                      title={tList('view.sortBy')}
                      aria-label={t(`columns.${column}`)}
                      className={cn('group inline-flex items-center gap-1 rounded py-1 uppercase tracking-wide hover:text-foreground', active && 'text-foreground')}
                    >
                      {t(`columns.${column}`)}
                      <Icon className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
                    </button>
                  </th>
                );
              })}
              <th className={cn('px-2 py-3', inline ? 'w-40' : 'w-12')}>
                <span className="sr-only">{tList('columns.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-10 text-center text-muted-foreground">
                  {filtered ? t('emptyFiltered') : tList('empty')}
                </td>
              </tr>
            )}
            {sortedRows.map((row) => (
              <Fragment key={row.id}>
                <tr
                  onClick={() => {
                    startNavProgress();
                    router.push(`/invoices/${row.id}`);
                  }}
                  className={cn(
                    'cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-accent/50',
                    selected.has(row.id) && 'bg-accent/40',
                    row.status === 'cancelled' && 'opacity-60'
                  )}
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={row.invoiceNumber ?? t('unnumbered')}
                      checked={selected.has(row.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                      className="accent-[hsl(var(--primary))]"
                    />
                  </td>
                  {columns.map((column) => (
                    <td key={column} className={cn('px-3 py-3', NUMERIC.includes(column) && 'text-right')}>
                      {cell(row, column)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowMenu row={row} inline={inline} />
                  </td>
                </tr>
                {row.source.startsWith('ai_') && row.status === 'pending_review' && (
                  <tr className="border-b border-border bg-warning/10 last:border-b-0">
                    <td colSpan={columns.length + 2} className="px-4 py-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-warning">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{tList('aiDisclaimer')}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          {totalsByCurrency.length > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-muted/30 text-sm">
                <td colSpan={columns.length + 2} className="px-4 py-3 text-right">
                  <span className="text-muted-foreground">{t('sumLabel')}: </span>
                  {totalsByCurrency.map(([currency, sum], i) => (
                    <span key={currency} className="font-bold tabular-nums">
                      {i > 0 && ' · '}
                      {formatMoney(sum, currency, locale)}
                    </span>
                  ))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** The per-row "⋯" menu, positioned `fixed` so the table's horizontal scroll never clips it. */
function RowMenu({ row, inline }: { row: InvoiceRow; inline: boolean }) {
  const t = useTranslations('doc');
  const router = useRouter();
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + 4 + 360 > window.innerHeight ? Math.max(8, rect.top - 364) : rect.bottom + 4;
    setPos({ top, right: window.innerWidth - rect.right });
  };

  const act = <T,>(fn: () => Promise<ActionResult<T>>, okText: string, after?: (data: T) => void) => {
    setPos(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast({ text: `${t('actionFailed')}: ${result.error}`, tone: 'err' });
        return;
      }
      toast({ text: okText, tone: 'ok' });
      if (after) after(result.data);
      else router.refresh();
    });
  };

  const isDraft = row.status === 'draft' || row.status === 'pending_review';
  const numbered = Boolean(row.invoiceNumber);
  const conversions = row.status === 'cancelled' || (!numbered && row.documentType !== 'quote') ? [] : CONVERSIONS[row.documentType];

  // `quick` items also get an icon button right in the row when inline actions are on.
  type Item = { icon: typeof Copy; label: string; onSelect: () => void; danger?: boolean; href?: string; quick?: boolean };
  const items: Item[] = [
    { icon: ExternalLink, label: t('actions.open'), onSelect: () => router.push(`/invoices/${row.id}`) },
    ...(isDraft
      ? [
          { icon: Pencil, label: t('actions.edit'), quick: true, onSelect: () => router.push(`/invoices/${row.id}/edit`) },
          {
            icon: Stamp,
            quick: true,
            label: row.documentType === 'quote' ? t('actions.issueQuote') : t('actions.issue'),
            onSelect: () => act(() => issueInvoice(row.id), t('done.issued'))
          }
        ]
      : []),
    ...(row.status === 'issued' && row.documentType !== 'quote'
      ? [{ icon: CheckCircle2, label: t('actions.markPaidToday'), quick: true, onSelect: () => act(() => markInvoicePaid(row.id), t('done.paid')) }]
      : []),
    ...(numbered ? [{ icon: Download, label: t('actions.downloadPdf'), quick: true, href: `/api/files/invoices/${row.id}/pdf`, onSelect: () => setPos(null) }] : []),
    ...(numbered && row.status !== 'cancelled'
      ? [{ icon: Send, label: t('actions.send'), quick: true, onSelect: () => act(() => sendInvoice(row.id), t('done.sent')) }]
      : []),
    { icon: Copy, label: t('actions.duplicate'), onSelect: () => router.push(`/invoices/new?from=${row.id}`) },
    ...conversions.map((to) => ({
      icon: Repeat2,
      label: t(`actions.convertTo.${to}`),
      onSelect: () => act(() => convertInvoice(row.id, to), t('done.converted'), (doc) => router.push(`/invoices/${doc.id}`))
    })),
    ...(row.status === 'issued'
      ? [
          {
            icon: Ban,
            label: t('actions.cancel'),
            danger: true,
            onSelect: () => window.confirm(t('confirm.cancelBody')) && act(() => cancelInvoice(row.id), t('done.cancelled'))
          }
        ]
      : []),
    ...(isDraft
      ? [
          {
            icon: Trash2,
            label: t('actions.delete'),
            danger: true,
            onSelect: () => window.confirm(t('confirm.deleteBody')) && act(() => deleteInvoice(row.id), t('done.deleted'))
          }
        ]
      : [])
  ];

  const quickClass =
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:opacity-50';

  return (
    <span className="inline-flex items-center justify-end gap-0.5">
      {inline &&
        items
          .filter((item) => item.quick)
          .map(({ icon: Icon, label, onSelect, href }) =>
            href ? (
              <a key={label} href={href} title={label} aria-label={label} className={quickClass}>
                <Icon className="h-4 w-4" />
              </a>
            ) : (
              <button key={label} type="button" disabled={pending} onClick={onSelect} title={label} aria-label={label} className={quickClass}>
                <Icon className="h-4 w-4" />
              </button>
            )
          )}
      <button
        ref={button}
        type="button"
        disabled={pending}
        onClick={() => (pos ? setPos(null) : open())}
        aria-label={t('rowActions')}
        aria-haspopup="menu"
        aria-expanded={Boolean(pos)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div role="menu" style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-56 rounded-xl border border-border bg-card p-1.5 text-left shadow-lg">
            {items.map(({ icon: Icon, label, onSelect, danger, href }) => {
              const className = cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-accent',
                danger ? 'text-destructive' : 'hover:text-primary'
              );
              return href ? (
                <a key={label} role="menuitem" href={href} onClick={onSelect} className={className}>
                  <Icon className="h-4 w-4" />
                  {label}
                </a>
              ) : (
                <button key={label} role="menuitem" type="button" onClick={onSelect} className={className}>
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}
