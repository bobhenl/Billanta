'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

export type ToastTone = 'ok' | 'err' | 'info';

export interface ToastInput {
  text: string;
  tone?: ToastTone;
  /** Optional action that makes the whole pill a shortcut ("View invoice"). */
  href?: string;
  linkLabel?: string;
}

const TOAST_EVENT = 'billanta:toast';
const SHOW_MS = 3200;
const FADE_MS = 200;

/**
 * Fire a toast from anywhere on the client (event handler, server-action
 * result). One pill at a time, like VoxelRank's favToast(): a newer toast
 * replaces the one on screen and restarts its timer.
 */
export function toast(input: ToastInput | string) {
  const detail: ToastInput = typeof input === 'string' ? { text: input } : input;
  window.dispatchEvent(new CustomEvent<ToastInput>(TOAST_EVENT, { detail }));
}

const ICONS = { ok: CheckCircle2, err: AlertCircle, info: Info } satisfies Record<ToastTone, unknown>;
const ICON_CLASS: Record<ToastTone, string> = {
  ok: 'text-success',
  err: 'text-destructive',
  info: 'text-primary'
};

/**
 * The floating "Saved" pill, after VoxelRank's .fav-toast: bottom-left on
 * desktop (the cookie card owns bottom-right), full width just above the tab
 * bar on phones. It is a polite live region, so screen readers announce it
 * without moving focus.
 */
export function Toaster() {
  const [current, setCurrent] = useState<ToastInput | null>(null);
  const [shown, setShown] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
    const onToast = (event: Event) => {
      clear();
      setCurrent((event as CustomEvent<ToastInput>).detail);
      setShown(false);
      // A tick later, so the browser has a hidden frame to transition from.
      timers.current.push(window.setTimeout(() => setShown(true), 16));
      timers.current.push(window.setTimeout(() => setShown(false), SHOW_MS));
      timers.current.push(window.setTimeout(() => setCurrent(null), SHOW_MS + FADE_MS));
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      clear();
      window.removeEventListener(TOAST_EVENT, onToast);
    };
  }, []);

  const tone = current?.tone ?? 'ok';
  const Icon = ICONS[tone];

  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      aria-live={tone === 'err' ? 'assertive' : 'polite'}
      className={cn(
        'fixed inset-x-3 z-[70] flex justify-center md:inset-x-auto md:bottom-4 md:left-4',
        'bottom-[calc(var(--tabbar-h)+12px+env(safe-area-inset-bottom,0px))]',
        current ? '' : 'pointer-events-none'
      )}
    >
      {current && (
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-lg transition-all duration-200',
            shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1.5 opacity-0'
          )}
        >
          <Icon className={cn('h-4 w-4 shrink-0', ICON_CLASS[tone])} aria-hidden="true" />
          <span>{current.text}</span>
          {current.href && current.linkLabel && (
            <Link href={current.href} className="whitespace-nowrap font-bold text-primary hover:underline">
              {current.linkLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Toast after a redirect: a page that navigates on success adds
 * `?toast=<key>` (e.g. `/invoices?toast=invoiceCreated`), this shows
 * `toasts.<key>` once and drops the parameter from the URL so a reload or a
 * shared link does not repeat it. Unknown keys are ignored.
 */
export function ToastFromQuery() {
  const t = useTranslations('toasts');
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const key = params.get('toast');

  useEffect(() => {
    if (!key) return;
    if (t.has(key)) toast(t(key));
    const rest = new URLSearchParams(params.toString());
    rest.delete('toast');
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [key, params, pathname, router, t]);

  return null;
}
