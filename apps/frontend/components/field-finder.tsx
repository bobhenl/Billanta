'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FinderEntry {
  /** Matches the `data-field` attribute of the element to jump to. */
  id: string;
  label: string;
  /** Section name shown next to the result. */
  section: string;
  /** Extra words people might type: synonyms, abbreviations, other languages. */
  keywords?: string;
}

export interface RequiredState {
  id: string;
  label: string;
  done: boolean;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** At most one edit (insert, delete, substitute) apart. */
function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Scores an entry for a query: 3 = label starts with it, 2 = label contains
 * it, 1 = keywords/section contain it or a single 5+ letter word is one typo
 * away from a word in the label or keywords; 0 = no match.
 */
function score(entry: FinderEntry, query: string) {
  const label = fold(entry.label);
  if (label.startsWith(query)) return 3;
  if (label.includes(query)) return 2;
  const rest = fold(`${entry.keywords ?? ''} ${entry.section}`);
  if (rest.includes(query)) return 1;
  if (!query.includes(' ') && query.length >= 5) {
    const words = `${label} ${rest}`.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    if (words.some((w) => withinOneEdit(w, query) || withinOneEdit(w.slice(0, query.length), query))) return 1;
  }
  return 0;
}

/** Briefly highlights the jumped-to field so the eye finds it. */
function flash(el: HTMLElement) {
  el.animate(
    [
      { boxShadow: '0 0 0 0 hsl(var(--primary) / 0)' },
      { boxShadow: '0 0 0 4px hsl(var(--primary) / 0.45)', offset: 0.15 },
      { boxShadow: '0 0 0 4px hsl(var(--primary) / 0.45)', offset: 0.7 },
      { boxShadow: '0 0 0 0 hsl(var(--primary) / 0)' }
    ],
    { duration: 1800, easing: 'ease-out' }
  );
}

/**
 * Scrolls to `[data-field=id]`, focuses its first control and flashes it.
 * Retries for a few frames so a field that was just revealed or whose section
 * was just expanded has time to render.
 */
export function jumpToField(id: string, attempts = 8) {
  const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(id)}"]`);
  if (!el) {
    if (attempts > 0) setTimeout(() => jumpToField(id, attempts - 1), 40);
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const control = el.matches('input, select, textarea, button')
    ? el
    : el.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button');
  control?.focus({ preventScroll: true });
  flash(control ?? el);
}

/**
 * "Find a field" box for long forms (pattern ported from VoxelRank's server
 * form): accent-insensitive, forgives one typo, matches synonyms, and jumps
 * straight to the field — opening its section first via `onPick`. Optionally
 * shows how many required fields are filled; clicking it jumps to the first
 * missing one. The input has no `name`, so it is never submitted.
 */
export function FieldFinder({
  entries,
  onPick,
  required,
  labels,
  className
}: {
  entries: FinderEntry[];
  /** Make the field visible (reveal it, expand its section); the jump follows. */
  onPick: (id: string) => void;
  required?: RequiredState[];
  labels: { placeholder: string; empty: string; required: (done: number, total: number) => string; allDone: string; missing: string };
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return [];
    return entries
      .map((entry, index) => ({ entry, s: score(entry, q), index }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.index - b.index)
      .slice(0, 8)
      .map((r) => r.entry);
  }, [entries, query]);

  const pick = (entry: FinderEntry) => {
    setQuery('');
    setOpen(false);
    onPick(entry.id);
    setTimeout(() => jumpToField(entry.id), 0);
  };

  const done = required?.filter((r) => r.done).length ?? 0;
  const total = required?.length ?? 0;
  const firstMissing = required?.find((r) => !r.done);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative min-w-[12rem] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          data-page-search
          role="combobox"
          aria-expanded={open && query.trim().length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          aria-label={labels.placeholder}
          autoComplete="off"
          value={query}
          placeholder={labels.placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (results[active]) pick(results[active]);
            } else if (e.key === 'Escape') {
              setQuery('');
              setOpen(false);
            }
          }}
          className="h-10 w-full rounded-full border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
        {open && query.trim() && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-auto rounded-xl border border-border bg-card p-1 shadow-lg"
          >
            {results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">{labels.empty}</li>
            ) : (
              results.map((entry, i) => (
                <li
                  key={entry.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(entry)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm',
                    i === active ? 'bg-secondary' : 'hover:bg-secondary/60'
                  )}
                >
                  <span className="truncate font-medium">{entry.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{entry.section}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {required && total > 0 && (
        <button
          type="button"
          onClick={() => {
            if (!firstMissing) return;
            onPick(firstMissing.id);
            setTimeout(() => jumpToField(firstMissing.id), 0);
          }}
          disabled={!firstMissing}
          title={firstMissing ? labels.missing : labels.allDone}
          className={cn(
            'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold tabular-nums transition-colors',
            firstMissing ? 'border-border text-muted-foreground hover:border-primary hover:text-primary' : 'border-success/40 bg-success/10 text-success'
          )}
        >
          {firstMissing ? <CircleDashed className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {labels.required(done, total)}
        </button>
      )}
    </div>
  );
}
