'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, BadgeCheck, ChevronRight, FilePlus2, Plus, Search, Star, User } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { Link, useRouter } from '@/i18n/navigation';
import { fuzzyScore } from '@/lib/fuzzy';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { readJson, writeJson } from '@/lib/invoice-list-prefs';
import { cn } from '@/lib/utils';
import { ColorDot } from '@/components/color-dot';
import { CONTACT_COLORS, CONTACT_COLOR_DOT } from '@/lib/contact-colors';
import type { Contact } from '../invoices/new/types';
import { setContactStarred } from './actions';
import { ContactEditor } from './contact-editor';
import { ContactsCsvButtons, SkippedRows, type Skip } from './contacts-csv';

export type ContactRow = Contact & {
  aresVerifiedAt: string | null;
  createdAt: string;
  /** Issued invoices to this customer (null = none yet). */
  stats: {
    count: number;
    revenueCzk: number;
    unpaid: number;
    lastIssue: string | null;
  } | null;
};
type Row = ContactRow;

const SORTS = ['name', 'newest', 'revenue', 'lastInvoice', 'unpaid', 'city'] as const;
type SortKey = (typeof SORTS)[number];
const SORT_KEY = 'billanta:contacts:sort';

/** Starred first only in the default order; the others are plain rankings. */
function compare(a: Row, b: Row, key: SortKey, locale: string) {
  const byName = a.legalName.localeCompare(b.legalName, locale);
  switch (key) {
    case 'name':
      return Number(b.isStarred) - Number(a.isStarred) || byName;
    case 'newest':
      return b.createdAt.localeCompare(a.createdAt);
    case 'revenue':
      return (b.stats?.revenueCzk ?? -1) - (a.stats?.revenueCzk ?? -1) || byName;
    case 'lastInvoice':
      return (b.stats?.lastIssue ?? '').localeCompare(a.stats?.lastIssue ?? '') || byName;
    case 'unpaid':
      return (b.stats?.unpaid ?? 0) - (a.stats?.unpaid ?? 0) || byName;
    case 'city':
      return (a.addressCity || '\uffff').localeCompare(b.addressCity || '\uffff', locale) || byName;
  }
}

/**
 * The tenant's customers: starred first, a local filter, a star toggle
 * (starred customers become one-tap picks on a new invoice) and a shortcut
 * to invoice the customer. The star flips optimistically and rolls back if
 * the backend refuses.
 */
export function ContactsList({
  initial,
  filtered = false,
  startCreating = false,
  filters
}: {
  initial: Row[];
  filtered?: boolean;
  startCreating?: boolean;
  /** The server-rendered filter panel, shown under the toolbar. */
  filters?: ReactNode;
}) {
  const t = useTranslations('contacts');
  const locale = useLocale();
  const [sort, setSort] = useState<SortKey>('name');
  useEffect(() => {
    const saved = readJson<string>(SORT_KEY, 'name');
    if (SORTS.includes(saved as SortKey)) setSort(saved as SortKey);
  }, []);
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState('');
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const tColors = useTranslations('contacts.colors');
  const [creating, setCreating] = useState(startCreating);
  const [skipped, setSkipped] = useState<Skip[]>([]);
  const router = useRouter();
  // A CSV import refreshes the server component; pick up the new list.
  useEffect(() => setRows(initial), [initial]);

  const visible = useMemo(() => {
    const q = query.trim();
    // Typo-tolerant: "novak" finds "Novák", "fakturant" finds "Fakturnat s.r.o.".
    const byColor = colorFilter ? rows.filter((r) => r.color === colorFilter) : rows;
    const filtered = q ? byColor.filter((r) => fuzzyScore(q, [r.legalName, r.ico, r.email, r.dic]) > 0) : byColor;
    return [...filtered].sort((a, b) => compare(a, b, sort, locale));
  }, [rows, query, sort, locale, colorFilter]);
  const usedColors = CONTACT_COLORS.filter((c) => rows.some((r) => r.color === c));

  const toggle = async (row: Row) => {
    const next = !row.isStarred;
    const set = (value: boolean) => setRows((all) => all.map((r) => (r.id === row.id ? { ...r, isStarred: value } : r)));
    set(next);
    const stored = await setContactStarred(row.id, next);
    if (stored === null) {
      set(!next);
      toast({ text: t('starFailed'), tone: 'err' });
    } else {
      toast(next ? t('starred', { name: row.legalName }) : t('unstarred', { name: row.legalName }));
    }
  };

  const editor = creating && <ContactEditor open onClose={() => setCreating(false)} onSaved={(c) => router.push(`/contacts/${c.id}`)} />;
  const newButton = (
    <button
      type="button"
      onClick={() => setCreating(true)}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90"
    >
      <Plus className="h-4 w-4" />
      {t('newContact')}
    </button>
  );

  if (rows.length === 0 && !filtered) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t('empty')}{' '}
        <Link href="/invoices/new" className="font-semibold text-primary hover:underline">
          {t('emptyCta')}
        </Link>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {newButton}
          <ContactsCsvButtons showExport={false} onSkipped={setSkipped} />
        </div>
        <SkippedRows rows={skipped} />
        {editor}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            data-page-search
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('filter')}
            aria-label={t('filter')}
            className="h-10 w-full rounded-full border border-input bg-card pl-9 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative inline-flex items-center">
            <ArrowUpDown className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <select
              value={sort}
              onChange={(e) => {
                const next = e.target.value as SortKey;
                setSort(next);
                writeJson(SORT_KEY, next);
              }}
              aria-label={t('sort.label')}
              className="h-10 rounded-full border border-input bg-card pl-8 pr-3 text-sm font-semibold outline-none focus:border-primary"
            >
              {SORTS.map((key) => (
                <option key={key} value={key}>
                  {t(`sort.${key}`)}
                </option>
              ))}
            </select>
          </label>
          <ContactsCsvButtons showExport onSkipped={setSkipped} />
          {newButton}
        </div>
      </div>
      {usedColors.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('colorFilter')}>
          <span className="mr-1 text-xs font-semibold text-muted-foreground">{t('colorFilter')}</span>
          {usedColors.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={colorFilter === c}
              onClick={() => setColorFilter((cur) => (cur === c ? null : c))}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors',
                colorFilter === c ? 'border-primary bg-accent text-primary' : 'border-border hover:bg-secondary'
              )}
            >
              <span className={cn('h-2.5 w-2.5 rounded-full', CONTACT_COLOR_DOT[c])} />
              {tColors(c)}
              <span className="text-muted-foreground">{rows.filter((r) => r.color === c).length}</span>
            </button>
          ))}
        </div>
      )}
      {filters}
      <SkippedRows rows={skipped} />
      {editor}

      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {visible.map((row) => (
          <li key={row.id} className="flex items-center gap-2 px-2 py-2 sm:px-3">
            <button
              type="button"
              onClick={() => toggle(row)}
              aria-pressed={row.isStarred}
              aria-label={row.isStarred ? t('unstar') : t('star')}
              title={row.isStarred ? t('unstar') : t('star')}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-secondary"
            >
              <Star className={cn('h-4 w-4', row.isStarred ? 'fill-warning text-warning' : 'text-muted-foreground')} />
            </button>
            <Link href={`/contacts/${row.id}`} className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                  <ColorDot color={row.color} label={row.color ? tColors(row.color) : undefined} />
                  {row.isPerson && <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t('editor.kindPerson')} />}
                  <span className="truncate group-hover:text-primary">{row.legalName}</span>
                  {row.aresVerifiedAt && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-label={t('aresVerified')} />}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[row.ico && `IČO ${row.ico}`, row.addressCity, row.email].filter(Boolean).join(' · ')}
                </p>
              </div>
              {row.stats && (
                <div className="hidden shrink-0 text-right text-xs sm:block">
                  {row.stats.revenueCzk > 0 && <p className="font-semibold tabular-nums">{formatMoney(row.stats.revenueCzk, 'CZK', locale)}</p>}
                  <p className="text-muted-foreground">
                    {t('stats.invoices', { count: row.stats.count })}
                    {row.stats.lastIssue && ` · ${formatDate(row.stats.lastIssue, locale)}`}
                  </p>
                </div>
              )}
              {row.stats && row.stats.unpaid > 0 && (
                <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning" title={t('stats.unpaidTitle')}>
                  {t('stats.unpaid', { count: row.stats.unpaid })}
                </span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
            <Link
              href={`/invoices/new?contact=${row.id}`}
              title={t('invoice')}
              aria-label={t('invoice')}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-primary transition-colors hover:bg-accent"
            >
              <FilePlus2 className="h-4 w-4" />
              <span className="hidden sm:inline">{t('invoice')}</span>
            </Link>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="mt-4 text-sm text-muted-foreground">{t('noMatch')}</p>}
    </div>
  );
}
