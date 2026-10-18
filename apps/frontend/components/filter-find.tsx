'use client';

import { useRef, useState } from 'react';
import { Search } from 'lucide-react';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Whether a field holds a value, so the search must not hide what is already filtering. */
function isSet(field: Element): boolean {
  return Array.from(field.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input:not([type=hidden]), select')).some((el) => el.value !== '');
}

/**
 * "Search filters…" at the top of the filter dialog: hides every field (and
 * a group left empty) whose label, hint or options don't contain the query,
 * so nobody scrolls through thirty selects for "upomínka". The box has no
 * `name`, so Apply never puts the query into the URL.
 */
export function FilterFind({ placeholder, none }: { placeholder: string; none: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [nothing, setNothing] = useState(false);

  function apply(query: string) {
    const form = ref.current?.closest('form');
    if (!form) return;
    const words = fold(query).split(/\s+/).filter(Boolean);
    let shown = 0;
    form.querySelectorAll<HTMLElement>('[data-filter-field]').forEach((field) => {
      const text = fold(field.textContent ?? '');
      const match = words.every((w) => text.includes(w)) || isSet(field);
      field.hidden = !match;
      if (match) shown++;
    });
    form.querySelectorAll<HTMLElement>('[data-filter-group]').forEach((group) => {
      group.hidden = !group.querySelector('[data-filter-field]:not([hidden])');
    });
    setNothing(shown === 0);
  }

  return (
    <div ref={ref} className="border-b border-border px-4 py-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          autoComplete="off"
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => apply(e.target.value)}
          onKeyDown={(e) => {
            // Enter would submit the filters, Escape would close the dialog: here they belong to the box.
            if (e.key === 'Enter') e.preventDefault();
            if (e.key === 'Escape' && e.currentTarget.value) {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.value = '';
              apply('');
            }
          }}
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </label>
      {nothing && <p className="mt-2 text-sm text-muted-foreground">{none}</p>}
    </div>
  );
}
