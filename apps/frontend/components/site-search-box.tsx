'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { fetchSiteHits, groupHits, KIND_ICON } from '@/components/site-search-kinds';
import type { SearchHit } from '@/lib/site-search';
import { cn } from '@/lib/utils';

/**
 * The /search box with instant results, styled after the in-app command
 * palette: results grouped by kind, ArrowUp/Down to move, Enter to open the
 * highlighted hit (or submit the form for the full results page), Escape to
 * close. It sits inside the server-rendered GET form, so without JavaScript
 * it is still a plain search field.
 */
export function SiteSearchBox({ defaultValue }: { defaultValue: string }) {
  const t = useTranslations('siteSearch');
  const locale = useLocale();
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    return fetchSiteHits(locale, q, (found) => {
      setHits(found);
      setActive(-1);
    });
  }, [value, locale]);

  // Grouped for display; `flat` keeps the keyboard order identical to it.
  const groups = useMemo(() => groupHits(hits), [hits]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const showList = open && flat.length > 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && flat.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp' && flat.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? flat.length - 1 : i - 1));
    } else if (e.key === 'Enter' && showList && active >= 0) {
      e.preventDefault();
      setOpen(false);
      router.push(flat[active]!.href);
    } else if (e.key === 'Escape') {
      if (showList) e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  let index = -1;
  return (
    <div className="relative flex-1">
      <label className="relative block">
        <span className="sr-only">{t('label')}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          autoFocus
          autoComplete="off"
          maxLength={100}
          placeholder={t('placeholder')}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </label>
      {showList && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <ul id={listId} role="listbox" aria-label={t('label')} className="max-h-[60vh] overflow-y-auto py-1">
            {groups.map((g) => {
              const Icon = KIND_ICON[g.kind];
              return (
                <li key={g.kind} role="presentation">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`kind.${g.kind}`)}</div>
                  <ul role="group" aria-label={t(`kind.${g.kind}`)}>
                    {g.items.map((hit) => {
                      index += 1;
                      const i = index;
                      return (
                        <li
                          key={`${hit.href}-${i}`}
                          id={`${listId}-${i}`}
                          role="option"
                          aria-selected={i === active}
                          onMouseEnter={() => setActive(i)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setOpen(false);
                            router.push(hit.href);
                          }}
                          className={cn('flex cursor-pointer items-start gap-2.5 px-3 py-2', i === active && 'bg-secondary')}
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground">{hit.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{hit.snippet}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">{t('keyboardHint')}</p>
        </div>
      )}
    </div>
  );
}
