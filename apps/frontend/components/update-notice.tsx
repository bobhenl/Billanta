'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Fire it when a server action fails: after a deploy the old tab's actions no longer exist. */
export const CHECK_BUILD_EVENT = 'billanta:check-build';
const EVERY_MS = 10 * 60 * 1000;

/**
 * Tells a tab that was open across a deploy to reload. Until it does, its
 * server actions point at a build that is gone, so search and forms quietly fail.
 */
export function UpdateNotice() {
  const t = useTranslations('updateNotice');
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_STAMP;
    if (!mine) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        const { build } = (await res.json()) as { build: string | null };
        if (build && build !== mine) setStale(true);
      } catch {
        /* offline or mid-deploy: try again later */
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(check, EVERY_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener(CHECK_BUILD_EVENT, check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener(CHECK_BUILD_EVENT, check);
    };
  }, []);

  if (!stale) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom,0px)+0.75rem)] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-lg md:bottom-4"
    >
      <span className="flex-1">{t('text')}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {t('reload')}
      </button>
    </div>
  );
}
