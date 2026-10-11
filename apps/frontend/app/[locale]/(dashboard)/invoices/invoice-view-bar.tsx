'use client';

import { useEffect, useState } from 'react';
import { Bookmark, BookmarkPlus, Check, Settings2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import {
  COLUMNS_KEY,
  PRESET_CHIPS,
  QUICK_COOKIE,
  readJson,
  SORT_KEY,
  STATUS_CHIPS,
  TYPE_CHIPS,
  VIEW_EVENT,
  VIEWS_KEY,
  writeJson,
  type PresetChip,
  type QuickPrefs,
  type SavedView
} from '@/lib/invoice-list-prefs';
import { cn } from '@/lib/utils';

const MAX_VIEWS = 12;

/**
 * Saved views (filters + columns + sorting, one click to come back) and the
 * "Přizpůsobit" popover that picks which quick-filter chips the list shows.
 * Views live in this browser; the chip choice is a cookie so the server
 * renders the right chips straight away.
 */
export function InvoiceViewBar({ query, quick }: { query: string; quick: QuickPrefs }) {
  const t = useTranslations('invoices.view');
  const tDoc = useTranslations('doc');
  const tStatus = useTranslations('invoices.status');
  const router = useRouter();
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => setViews(readJson<SavedView[]>(VIEWS_KEY, []).filter((v) => v && typeof v.query === 'string')), []);

  const storeViews = (next: SavedView[]) => {
    setViews(next);
    writeJson(VIEWS_KEY, next);
  };

  const apply = (view: SavedView) => {
    if (view.columns?.length) writeJson(COLUMNS_KEY, view.columns);
    writeJson(SORT_KEY, view.sort ?? null);
    window.dispatchEvent(new Event(VIEW_EVENT));
    router.push(view.query ? `/invoices?${view.query}` : '/invoices');
  };

  const save = () => {
    const name = naming?.trim();
    if (!name) return;
    const view: SavedView = {
      id: Math.random().toString(36).slice(2, 10),
      name: name.slice(0, 40),
      query,
      columns: readJson<string[] | undefined>(COLUMNS_KEY, undefined),
      sort: readJson<SavedView['sort']>(SORT_KEY, null)
    };
    storeViews([...views.filter((v) => v.name !== view.name), view].slice(-MAX_VIEWS));
    setNaming(null);
    toast({ text: t('saved', { name: view.name }), tone: 'ok' });
  };

  const writeQuick = (next: QuickPrefs) => {
    try {
      document.cookie = `${QUICK_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // cookies blocked — the chips just stay as they are
    }
    router.refresh();
  };

  const flip = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const pill = 'inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary';
  const groupTitle = 'mb-1 mt-3 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground first:mt-0';
  const option = 'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-accent';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map((view) => {
        const active = view.query === query;
        return (
          <span
            key={view.id}
            className={cn(
              'group inline-flex items-center rounded-full text-sm font-semibold transition-colors',
              active ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-primary'
            )}
          >
            <button type="button" onClick={() => apply(view)} className="inline-flex items-center gap-1 py-1.5 pl-3 pr-1" title={t('applyView')}>
              <Bookmark className={cn('h-3.5 w-3.5', active && 'fill-current')} />
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => storeViews(views.filter((v) => v.id !== view.id))}
              aria-label={t('deleteView', { name: view.name })}
              title={t('deleteView', { name: view.name })}
              className="mr-1 rounded-full p-0.5 opacity-50 hover:bg-background hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      {naming === null ? (
        <button type="button" onClick={() => setNaming('')} className={pill} title={t('saveHint')} aria-label={t('saveView')}>
          <BookmarkPlus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('saveView')}</span>
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background py-0.5 pl-3 pr-0.5"
        >
          <input
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
            placeholder={t('viewName')}
            maxLength={40}
            className="w-36 bg-transparent text-sm outline-none"
          />
          <button type="submit" aria-label={t('save')} className="rounded-full bg-primary p-1.5 text-primary-foreground hover:opacity-90">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setNaming(null)} aria-label={t('cancel')} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent">
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      )}

      <div className="relative">
        <button type="button" onClick={() => setCustomizing((o) => !o)} aria-expanded={customizing} aria-label={t('customize')} className={pill}>
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline">{t('customize')}</span>
        </button>
        {customizing && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setCustomizing(false)} />
            <div className="absolute right-0 z-40 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-lg">
              <InfoHint hint={t('customizeHint')}>
                <span className="text-sm font-bold">{t('customizeTitle')}</span>
              </InfoHint>
              <div className="mt-2">
                <p className={groupTitle}>{t('presetChips')}</p>
                {PRESET_CHIPS.map((p) => (
                  <label key={p} className={option}>
                    <input
                      type="checkbox"
                      checked={quick.presets.includes(p)}
                      onChange={() => writeQuick({ ...quick, presets: PRESET_CHIPS.filter((x) => (x === p ? !quick.presets.includes(p) : quick.presets.includes(x))) as PresetChip[] })}
                      className="accent-[hsl(var(--primary))]"
                    />
                    {t(`presets.${p}`)}
                  </label>
                ))}
                <p className={groupTitle}>{t('typeChips')}</p>
                {TYPE_CHIPS.map((type) => (
                  <label key={type} className={option}>
                    <input
                      type="checkbox"
                      checked={!quick.hiddenTypes.includes(type)}
                      onChange={() => writeQuick({ ...quick, hiddenTypes: flip(quick.hiddenTypes, type) })}
                      className="accent-[hsl(var(--primary))]"
                    />
                    {tDoc(`typePlural.${type}`)}
                  </label>
                ))}
                <p className={groupTitle}>{t('statusChips')}</p>
                {STATUS_CHIPS.map((status) => (
                  <label key={status} className={option}>
                    <input
                      type="checkbox"
                      checked={!quick.hiddenStatuses.includes(status)}
                      onChange={() => writeQuick({ ...quick, hiddenStatuses: flip(quick.hiddenStatuses, status) })}
                      className="accent-[hsl(var(--primary))]"
                    />
                    {status === 'overdue' ? tDoc('overdue') : tStatus(status)}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
