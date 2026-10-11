'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { fetchNotificationPrefs, fetchNotifications, fetchUnreadCount, markNotificationsRead } from '@/lib/notification-actions';
import { EVENT_TONE, type AppNotification } from '@/lib/notifications';
import { cn } from '@/lib/utils';

const POLL_MS = 60_000;

/**
 * The header bell: unread badge (polled every minute while the tab is
 * visible), a dropdown with the latest notifications, and — when the member
 * allowed it in Settings → Notifikace and the browser granted permission —
 * a system popup for anything new that arrived since the last poll.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const lastUnread = useRef<number | null>(null);
  const popups = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await fetchNotifications(20);
    if (!data) return;
    setItems(data.items);
    setUnread(data.unread);
    return data;
  }, []);

  useEffect(() => {
    fetchNotificationPrefs().then((p) => {
      popups.current = Boolean(p?.browserPopups);
    });
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const n = await fetchUnreadCount();
      if (n === null) return;
      setUnread(n);
      const prev = lastUnread.current;
      lastUnread.current = n;
      // Something new since the last poll → browser popup with the newest one.
      if (prev !== null && n > prev && popups.current && 'Notification' in window && Notification.permission === 'granted') {
        const data = await load();
        const newest = data?.items.find((i) => !i.readAt);
        if (newest) {
          const note = new Notification(newest.title, { body: newest.body ?? undefined, tag: newest.id, icon: '/icon.svg' });
          note.onclick = () => {
            window.focus();
            if (newest.link) router.push(newest.link);
          };
        }
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, router]);

  useEffect(() => {
    if (!open) return;
    load();
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
  }, [open, load]);

  const readAll = async () => {
    await markNotificationsRead();
    setUnread(0);
    lastUnread.current = 0;
    setItems((list) => list?.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) ?? null);
  };

  const openItem = async (item: AppNotification) => {
    setOpen(false);
    if (!item.readAt) {
      setUnread((n) => Math.max(0, n - 1));
      lastUnread.current = Math.max(0, (lastUnread.current ?? 1) - 1);
      markNotificationsRead(item.id);
    }
    if (item.link) router.push(item.link);
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? t('bellUnread', { count: unread }) : t('bell')}
        title={t('bell')}
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-bold">{t('title')}</span>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={readAll}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {t('readAll')}
                </button>
              )}
              <Link
                href="/settings/notifications"
                onClick={() => setOpen(false)}
                title={t('settings')}
                aria-label={t('settings')}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items === null && <p className="px-3 py-6 text-center text-sm text-muted-foreground">…</p>}
            {items?.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>}
            {items?.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openItem(item)}
                className={cn(
                  'flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-secondary/60',
                  !item.readAt && 'bg-primary/5'
                )}
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', item.readAt ? 'bg-border' : (EVENT_TONE[item.kind] ?? 'bg-primary'))} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm', !item.readAt && 'font-semibold')}>{item.title}</span>
                  {item.body && <span className="block truncate text-xs text-muted-foreground">{item.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {format.relativeTime(new Date(item.createdAt))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
