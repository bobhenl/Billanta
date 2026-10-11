'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TypeaheadGroup<T> {
  label?: string;
  items: T[];
}

/**
 * Text input with a suggestion list underneath: debounced async lookup,
 * arrow keys + Enter to pick, Escape to close (WAI-ARIA combobox pattern).
 * Used for customers (contacts + ARES), line items (previous invoices) and
 * anywhere else a field can be completed from known data.
 *
 * `fetchGroups` is typically a server action; results for a stale query are
 * dropped so a slow response can never overwrite a newer one. A slower
 * second source (`fetchMoreGroups`, e.g. company registers) runs alongside and
 * its groups are appended when they arrive, so fast results show at once.
 */
export function Typeahead<T>({
  value,
  onChange,
  onPick,
  fetchGroups,
  fetchMoreGroups,
  moreLoadingHint,
  renderItem,
  getKey,
  placeholder,
  minChars = 2,
  refreshKey,
  className,
  inputClassName,
  ariaLabel,
  emptyHint
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (item: T) => void;
  fetchGroups: (query: string) => Promise<TypeaheadGroup<T>[]>;
  fetchMoreGroups?: (query: string) => Promise<TypeaheadGroup<T>[]>;
  /** Shown under the fast results while `fetchMoreGroups` is still running. */
  moreLoadingHint?: ReactNode;
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string;
  placeholder?: string;
  minChars?: number;
  /** Changing it re-runs the lookup for the current text (e.g. another register picked). */
  refreshKey?: string;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
  emptyHint?: ReactNode;
}) {
  const listId = useId();
  const [fastGroups, setFastGroups] = useState<TypeaheadGroup<T>[]>([]);
  const [moreGroups, setMoreGroups] = useState<TypeaheadGroup<T>[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const groups = [...fastGroups, ...moreGroups];
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const latest = useRef('');
  // Held in a ref so an inline (re-created every render) fetcher cannot re-trigger the lookup.
  const fetcher = useRef(fetchGroups);
  fetcher.current = fetchGroups;
  const moreFetcher = useRef(fetchMoreGroups);
  moreFetcher.current = fetchMoreGroups;
  const suppressNext = useRef(false);

  const flat = groups.flatMap((g) => g.items);

  useEffect(() => {
    if (suppressNext.current) {
      suppressNext.current = false;
      return;
    }
    const q = value.trim();
    latest.current = q;
    if (q.length < minChars) {
      setFastGroups([]);
      setMoreGroups([]);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const nonEmpty = (r: TypeaheadGroup<T>[]) => r.filter((g) => g.items.length > 0);
      setMoreGroups([]);
      void fetcher.current(q)
        .catch(() => [])
        .then((result) => {
          if (latest.current !== q) return;
          setFastGroups(nonEmpty(result));
          setActive(0);
          setLoading(false);
        });
      const more = moreFetcher.current;
      if (more) {
        setLoadingMore(true);
        void more(q)
          .catch(() => [])
          .then((result) => {
            if (latest.current !== q) return;
            setMoreGroups(nonEmpty(result));
            setLoadingMore(false);
          });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [value, minChars, refreshKey]);

  const pick = (item: T) => {
    suppressNext.current = true;
    onPick(item);
    setOpen(false);
    setFastGroups([]);
    setMoreGroups([]);
  };

  const busy = loading || loadingMore;
  const showList = open && value.trim().length >= minChars && (flat.length > 0 || (busy && moreLoadingHint) || (!busy && emptyHint));
  let index = -1;

  return (
    <div className={cn('relative', className)}>
      <input
        type="text"
        role="combobox"
        aria-expanded={Boolean(showList)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={showList && flat[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (!showList || flat.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => (i + 1) % flat.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => (i - 1 + flat.length) % flat.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            pick(flat[active]!);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={cn(
          'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/30',
          inputClassName
        )}
      />
      {busy && (
        <Loader2 className="pointer-events-none absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      )}
      {showList && (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-card p-1 shadow-xl"
        >
          {flat.length === 0 && !busy
            ? <div className="px-3 py-2 text-xs text-muted-foreground">{emptyHint}</div>
            : groups.map((group, g) => (
                <div key={g}>
                  {group.label && (
                    <p className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                  )}
                  {group.items.map((item) => {
                    index += 1;
                    const i = index;
                    return (
                      <div
                        key={getKey(item)}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          pick(item);
                        }}
                        onMouseEnter={() => setActive(i)}
                        className={cn('cursor-pointer rounded-md px-2.5 py-2 text-sm', i === active && 'bg-secondary')}
                      >
                        {renderItem(item)}
                      </div>
                    );
                  })}
                </div>
              ))}
          {loadingMore && moreLoadingHint && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {moreLoadingHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
