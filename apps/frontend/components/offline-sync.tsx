'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  claimOfflineScope,
  clearCachedPages,
  OFFLINE_WARM_KEY as WARM_KEY,
  clearOfflineData,
  discardItem,
  listOutbox,
  onOutboxChange,
  retryItem,
  syncOutbox,
  adoptExistingContact,
  type OutboxItem
} from '@/lib/offline-outbox';
import { cn } from '@/lib/utils';

interface OfflineState {
  /** `${userId}:${tenantId}`, or null when the layout could not resolve the company (nothing is queued then). */
  scope: string | null;
  online: boolean;
  items: OutboxItem[];
  /** Sends whatever waits, e.g. right after something was queued while online. */
  sync: () => void;
}

const OfflineContext = createContext<OfflineState>({ scope: null, online: true, items: [], sync: () => {} });

export function useOffline() {
  return useContext(OfflineContext);
}

/**
 * Asks before a sign-out or company switch would wipe drafts that never
 * reached the server, then clears the queue and the cached pages. Returns
 * false when the member cancels.
 */
export function useLeaveOffline() {
  const t = useTranslations('offline');
  const { items } = useOffline();
  return useCallback(async () => {
    if (items.length > 0 && !window.confirm(t('leaveConfirm', { count: items.length }))) return false;
    await clearOfflineData();
    return true;
  }, [items.length, t]);
}

/**
 * Dashboard-wide owner of the offline queue (docs/offline-drafts-plan.md):
 * claims the scope on load (wiping another account's leftovers), tracks
 * the connection, and syncs on load and whenever the browser comes back
 * online.
 */
export function OfflineProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const ready = useRef(false);

  const reload = useCallback(async () => {
    if (!scope || !ready.current) return;
    setItems(await listOutbox(scope).catch(() => []));
  }, [scope]);

  const sync = useCallback(() => {
    if (!scope || !ready.current) return;
    const before = items.length;
    syncOutbox(scope).then(async () => {
      const left = await listOutbox(scope).catch(() => []);
      setItems(left);
      // Synced drafts should show up in the list the member is looking at.
      if (left.length < before) router.refresh();
    });
  }, [scope, items.length, router]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    claimOfflineScope(scope).then(async () => {
      if (cancelled) return;
      ready.current = true;
      warmOfflinePages(locale);
      setItems(await listOutbox(scope).catch(() => []));
    });
    const off = onOutboxChange(() => void reload());
    return () => {
      cancelled = true;
      ready.current = false;
      off();
    };
  }, [scope, reload, locale]);

  // First sync once the queue is loaded, then each time the connection returns.
  const pending = items.some((i) => i.status === 'pending');
  useEffect(() => {
    if (online && pending) sync();
    // `sync` changes with the item count; re-running on that would loop while items wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, pending]);

  return <OfflineContext.Provider value={{ scope, online, items, sync }}>{children}</OfflineContext.Provider>;
}

const WARM_EVERY_MS = 10 * 60_000;

/*
 * Client-side navigation never loads a page's HTML, so the worker would only
 * keep pages the member happened to open with a full load. Once the scope is
 * claimed, ask it to fetch the three offline pages; at most every ten
 * minutes per tab, as each one is a full server render.
 */
function warmOfflinePages(locale: string) {
  if (!navigator.onLine || !navigator.serviceWorker?.controller) return;
  try {
    const last = Number(sessionStorage.getItem(WARM_KEY) ?? 0);
    if (Date.now() - last < WARM_EVERY_MS) return;
    sessionStorage.setItem(WARM_KEY, String(Date.now()));
  } catch {
    // no sessionStorage: warm anyway
  }
  navigator.serviceWorker.controller.postMessage({
    type: 'warm',
    urls: [`/${locale}/dashboard`, `/${locale}/invoices/new`, `/${locale}/contacts`]
  });
}

/** On the login page: whoever signs in next must not get the previous account's cached pages. */
export function ClearCachedPages() {
  useEffect(() => {
    void clearCachedPages();
  }, []);
  return null;
}

/** Header pill: "Offline" without a connection, "N waiting" while drafts wait; opens the queue. */
export function OfflineIndicator() {
  const t = useTranslations('offline');
  const { scope, online, items, sync } = useOffline();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  if (online && items.length === 0) return null;
  const attention = items.some((i) => i.status !== 'pending');

  const act = async (run: () => Promise<void>) => {
    await run();
    sync();
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => items.length > 0 && setOpen((v) => !v)}
        aria-expanded={open}
        title={online ? undefined : t('offlineHint')}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors',
          attention
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : online
              ? 'border-border bg-secondary text-foreground hover:bg-secondary/70'
              : 'border-border bg-secondary text-muted-foreground'
        )}
      >
        {online ? <RefreshCw className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
        <span className={cn(items.length > 0 && !online && 'hidden sm:inline')}>{online ? null : t('offline')}</span>
        {items.length > 0 && <span>{t('waiting', { count: items.length })}</span>}
      </button>

      {open && scope && (
        // On phones the pill sits next to the logo, so the panel spans the screen instead of hanging off its left edge.
        <div className="fixed inset-x-4 top-14 z-50 overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[22rem] rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-bold">{t('title')}</p>
            <p className="text-xs text-muted-foreground">{online ? t('onlineNote') : t('offlineNote')}</p>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} className="border-b border-border/60 px-3 py-2.5 last:border-0">
                <p className="text-sm font-semibold">
                  <span className="mr-1.5 text-xs font-normal text-muted-foreground">{t(KIND_LABEL[item.kind])}</span>
                  {item.label}
                </p>
                {item.status === 'pending' && <p className="text-xs text-muted-foreground">{t('statusPending')}</p>}
                {item.status === 'failed' && (
                  <p className="text-xs text-destructive">
                    {item.kind === 'voice' && item.error && VOICE_ERRORS.has(item.error)
                      ? t(`voiceErrors.${item.error}`)
                      : t('statusFailed', { code: item.error ?? '' })}
                  </p>
                )}
                {item.status === 'conflict' && item.conflict && (
                  <p className="text-xs text-destructive">{t('statusConflict', { name: item.conflict.legalName })}</p>
                )}
                {item.status !== 'pending' && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.status === 'conflict' ? (
                      <button type="button" onClick={() => act(() => adoptExistingContact(scope, item))} className={pillButton}>
                        {t('useExisting')}
                      </button>
                    ) : (
                      <button type="button" onClick={() => act(() => retryItem(item))} disabled={!online} className={pillButton}>
                        {t('retry')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => window.confirm(t('discardConfirm')) && act(() => discardItem(scope, item))}
                      className={pillButton}
                    >
                      {t('discard')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const KIND_LABEL = { contact: 'kindContact', invoice: 'kindInvoice', voice: 'kindVoice' } as const;
/** Backend codes a queued voice note can fail with that deserve a sentence instead of the raw code. */
const VOICE_ERRORS = new Set(['voice_unavailable', 'voice_empty', 'voice_too_large', 'ai_disabled', 'ai_key_missing']);

const pillButton =
  'rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50';
