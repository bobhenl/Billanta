'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const MINUTE = 60_000;

/**
 * The strip above every dashboard page of a demo company: how long it has
 * left, the AI quota, and the two ways out. Both ways out end the demo
 * session first (/api/demo/end), so the sign-up form or the next demo starts
 * with a clean browser.
 */
export function DemoBanner({ expiresAt, aiLeft, locale }: { expiresAt: string; aiLeft: number | null; locale: string }) {
  const t = useTranslations('demo');
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  const h = Math.floor(left / (60 * MINUTE));
  const m = Math.floor((left % (60 * MINUTE)) / MINUTE);
  const time = h > 0 ? t('banner.hours', { h, m }) : t('banner.minutes', { m });

  async function leave(next: '/signup' | '/demo') {
    setLeaving(true);
    const res = await fetch('/api/demo/end', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ next, locale })
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { redirect?: string } | null;
    window.location.assign(data?.redirect ?? `/${locale}${next}`);
  }

  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex flex-col gap-3 rounded-lg border px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between',
        h < 1 ? 'border-warning/40 bg-warning/10' : 'border-primary/30 bg-primary/5'
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {t('banner.label')}
        </span>
        {/* The server's clock and the browser's can straddle a minute. */}
        <span suppressHydrationWarning>{t('banner.left', { time })}</span>
        {aiLeft !== null && <span className="text-muted-foreground">{t('banner.ai', { n: aiLeft })}</span>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button type="button" disabled={leaving} onClick={() => leave('/signup')} className={cn(buttonClass.primary, 'py-1.5')}>
          {t('banner.register')}
        </button>
        <button type="button" disabled={leaving} onClick={() => leave('/demo')} className={cn(buttonClass.secondary, 'py-1.5')}>
          {t('banner.restart')}
        </button>
      </div>
    </div>
  );
}
