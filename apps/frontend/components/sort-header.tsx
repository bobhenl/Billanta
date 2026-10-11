'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useLocale } from 'next-intl';
import { readJson, writeJson } from '@/lib/invoice-list-prefs';
import { cn } from '@/lib/utils';

export type SortState<K extends string> = {
  key: K;
  dir: 'asc' | 'desc';
} | null;
type SortValue = string | number | null | undefined;

/**
 * Client-side column sorting remembered per list in this browser (same
 * behaviour as the invoice table): a header click goes first direction →
 * the other → back to the server's order; empty values always go last.
 */
export function useListSort<K extends string, R>(
  storageKey: string,
  keys: readonly K[],
  rows: R[],
  valueOf: (row: R, key: K) => SortValue,
  numeric: readonly K[] = []
) {
  const locale = useLocale();
  const [sort, setSort] = useState<SortState<K>>(null);

  useEffect(() => {
    const raw = readJson<SortState<K>>(storageKey, null);
    if (raw && keys.includes(raw.key) && (raw.dir === 'asc' || raw.dir === 'desc')) setSort(raw);
    // keys are a module constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const apply = (next: SortState<K>) => {
    setSort(next);
    writeJson(storageKey, next);
  };

  const cycle = (key: K) => {
    const first = numeric.includes(key) ? 'desc' : 'asc';
    apply(sort?.key !== key ? { key, dir: first } : sort.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null);
  };

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = valueOf(a, sort.key) ?? null;
      const y = valueOf(b, sort.key) ?? null;
      if (x === null || x === '' || y === null || y === '') return x === y ? 0 : x === null || x === '' ? 1 : -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * factor;
      return String(x).localeCompare(String(y), locale, { numeric: true }) * factor;
    });
    // valueOf is a stable module-level function in every caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, locale]);

  return { sort, cycle, set: apply, sorted };
}

/** A `<th>` whose label sorts the column. */
export function SortHeader<K extends string>({
  column,
  label,
  sort,
  onSort,
  title,
  align = 'left',
  className
}: {
  column: K;
  label: string;
  sort: SortState<K>;
  onSort: (key: K) => void;
  title?: string;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort?.key === column;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('px-2 py-2.5 font-medium', align === 'right' && 'text-right', className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        title={title}
        className={cn(
          'group inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-foreground',
          align === 'right' && 'flex-row-reverse',
          active && 'text-foreground'
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
      </button>
    </th>
  );
}
