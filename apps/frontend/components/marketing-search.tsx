'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, BadgePercent, BookA, FilePlus2, Loader2, Search, Sparkles, X, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { fetchSiteHits, groupHits, KIND_ICON } from '@/components/site-search-kinds';
import { CALCULATORS, GUIDES, isPublishedIn } from '@/lib/public-tools';
import type { SearchHit, SearchKind } from '@/lib/site-search';
import { cn } from '@/lib/utils';

interface Row {
  id: string;
  href: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  /** Group heading (message key under siteSearch.kind / tools.search). */
  group: string;
}

/** True while the user is typing somewhere, so "/" is left alone. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Header search for the public site, modelled on the in-app Ctrl K palette
 * (components/command-palette.tsx): the icon, Ctrl/⌘ K or "/" opens a dialog
 * with instant suggestions from the same index as /search (features,
 * calculators, guides, FAQ, pages, municipalities), grouped by kind, with
 * ArrowUp/Down, Enter and Escape. The last row always opens the full
 * results page, which stays the place for everything else.
 *
 * The trigger is a real link to /search, so without JavaScript (or with a
 * modifier-click) it still goes to the results page. With an empty query
 * the dialog shows quick links instead of nothing.
 */
export function MarketingSearch() {
  const t = useTranslations('siteSearch');
  const tTools = useTranslations('tools');
  const tNav = useTranslations('marketing.nav');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
      } else if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTyping(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A navigation closes the dialog (also covers Link clicks inside it).
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHits(null);
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) {
      setHits(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return fetchSiteHits(locale, q, setHits, () => setLoading(false));
  }, [q, locale]);

  // Quick links for the empty state: the published calculators and guides
  // first (what people search the marketing site for), then the main pages.
  const quick = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    for (const c of CALCULATORS) {
      if (!isPublishedIn(c, locale)) continue;
      rows.push({ id: `calc:${c.slug}`, href: `/calculators/${c.slug}`, label: tTools(`calculators.items.${c.key}.name`), icon: c.icon, group: 'calculator' });
    }
    for (const g of GUIDES) {
      if (!isPublishedIn(g, locale)) continue;
      rows.push({ id: `guide:${g.slug}`, href: `/guides/${g.slug}`, label: tTools(`guides.items.${g.key}.name`), icon: g.icon, group: 'guide' });
    }
    rows.push(
      { id: 'page:features', href: '/features', label: tNav('features'), icon: Sparkles, group: 'page' },
      { id: 'page:pricing', href: '/pricing', label: tNav('pricing'), icon: BadgePercent, group: 'page' },
      { id: 'page:guest', href: '/create-invoice', label: tNav('guestInvoice'), icon: FilePlus2, group: 'page' },
      { id: 'page:glossary', href: '/glossary', label: tTools('menu.glossary'), icon: BookA, group: 'page' }
    );
    return rows;
  }, [locale, tTools, tNav]);

  const rows = useMemo<Row[]>(() => {
    if (q.length < 2 || hits === null) return quick;
    const out: Row[] = groupHits(hits).flatMap((g) =>
      g.items.map((hit, i) => ({
        id: `${g.kind}:${hit.href}:${i}`,
        href: hit.href,
        label: hit.title,
        hint: hit.snippet,
        icon: KIND_ICON[g.kind],
        group: g.kind
      }))
    );
    out.push({ id: 'all', href: `/search?q=${encodeURIComponent(q)}`, label: tTools('search.showAll', { query: q }), icon: ArrowRight, group: 'all' });
    return out;
  }, [q, hits, quick, tTools]);

  useEffect(() => setActive(0), [rows]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (rows.length ? (i <= 0 ? rows.length - 1 : i - 1) : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[active];
      if (row) go(row.href);
      else if (q) go(`/search?q=${encodeURIComponent(q)}`);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  const heading = (group: string) =>
    group === 'all' ? null : q.length >= 2 && hits !== null ? t(`kind.${group as SearchKind}`) : group === 'page' ? tTools('search.pages') : t(`kind.${group as SearchKind}`);

  return (
    <>
      <Link
        href="/search"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          setOpen(true);
        }}
        aria-label={tNav('search')}
        aria-haspopup="dialog"
        title={`${tNav('search')} (Ctrl K)`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Link>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-3 backdrop-blur-sm sm:px-4 sm:pt-[12vh]"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div role="dialog" aria-modal="true" aria-label={t('title')} className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl">
              <form
                role="search"
                action={`/${locale}/search`}
                method="get"
                onSubmit={(event) => event.preventDefault()}
                className="flex items-center gap-2 border-b border-border px-4"
              >
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  ref={inputRef}
                  type="search"
                  name="q"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onInputKey}
                  maxLength={100}
                  autoComplete="off"
                  placeholder={t('placeholder')}
                  aria-label={t('label')}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
                  className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm [&::-webkit-search-cancel-button]:hidden"
                />
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                <kbd className="hidden rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:inline">Esc</kbd>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={tTools('search.close')}
                  className="-mr-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground sm:hidden"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>

              <div ref={listRef} id={listId} role="listbox" aria-label={t('label')} className="max-h-[70vh] overflow-y-auto p-2 sm:max-h-[60vh]">
                {q.length >= 2 && hits !== null && hits.length === 0 && (
                  <p className="px-3 pb-1 pt-3 text-sm text-muted-foreground">{tTools('search.noResults')}</p>
                )}
                {rows.map((row, index) => {
                  const Icon = row.icon;
                  const first = index === 0 || rows[index - 1]?.group !== row.group;
                  const title = first ? heading(row.group) : null;
                  return (
                    <div key={row.id}>
                      {title && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>}
                      <a
                        href={`/${locale}${row.href}`}
                        id={`${listId}-${index}`}
                        data-index={index}
                        role="option"
                        aria-selected={index === active}
                        onMouseMove={() => setActive(index)}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                          event.preventDefault();
                          go(row.href);
                        }}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                          index === active ? 'bg-accent text-foreground' : 'text-foreground/90',
                          row.group === 'all' && 'mt-1 border-t border-border font-semibold text-primary'
                        )}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{row.label}</span>
                          {row.hint && <span className="block truncate text-xs text-muted-foreground">{row.hint}</span>}
                        </span>
                      </a>
                    </div>
                  );
                })}
              </div>
              <div className="hidden items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
                <span>{t('keyboardHint')}</span>
                <span className="ml-auto">
                  <kbd className="rounded border border-border px-1 font-semibold">/</kbd> {tTools('search.slashHint')}
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
