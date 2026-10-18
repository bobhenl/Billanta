'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DEMO_VIEW_ROLES, type DemoKind, type DemoViewRole } from '@/lib/demo';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const MINUTE = 60_000;

/**
 * The strip above every dashboard page of a demo company: how long it has
 * left, the AI quota, whose eyes the visitor looks through (owner, the
 * accountant, a read-only colleague), and the ways out. Every way out ends
 * the demo session first, so the sign-up form or the next demo starts with
 * a clean browser; "create an account" also hands what the visitor made over
 * to the new account (/api/demo/transfer).
 */
export function DemoBanner({
  expiresAt,
  aiLeft,
  locale,
  kind,
  role
}: {
  expiresAt: string;
  aiLeft: number | null;
  locale: string;
  kind: DemoKind | null;
  role: DemoViewRole;
}) {
  const t = useTranslations('demo');
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  const h = Math.floor(left / (60 * MINUTE));
  const m = Math.floor((left % (60 * MINUTE)) / MINUTE);
  const time = h > 0 ? t('banner.hours', { h, m }) : t('banner.minutes', { m });

  /** POSTs to a demo route and follows its redirect (or reloads); shows the route's error otherwise. */
  async function go(path: string, body: Record<string, unknown>, fallback?: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, locale })
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { redirect?: string; error?: string } | null;
    if (res?.ok || fallback) {
      // A full load, so every server component sees the new session cookie.
      if (data?.redirect ?? fallback) window.location.assign(data?.redirect ?? fallback!);
      else window.location.reload();
      return;
    }
    const code = data?.error && t.has(`errors.${data.error}`) ? data.error : 'demo_unavailable';
    setError(t(`errors.${code}`));
    setBusy(false);
  }

  const switchRole = (next: DemoViewRole) => next !== role && go('/api/demo/role', { role: next });
  const startEmpty = () => kind && window.confirm(t('banner.emptyConfirm')) && go('/api/demo/start', { kind, empty: true });

  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex flex-col gap-3 rounded-lg border px-3 py-2.5 text-sm lg:flex-row lg:flex-wrap lg:items-center lg:justify-between',
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
        {error && (
          <span role="alert" className="basis-full text-destructive">
            {error}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{t('banner.viewAs')}</span>
          <select
            value={role}
            disabled={busy}
            onChange={(e) => switchRole(e.target.value as DemoViewRole)}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {DEMO_VIEW_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}.label`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => go('/api/demo/transfer', {}, `/${locale}/signup`)} className={cn(buttonClass.primary, 'py-1.5')}>
          {t('banner.register')}
        </button>
        {kind && (
          <button type="button" disabled={busy} onClick={startEmpty} className={cn(buttonClass.secondary, 'py-1.5')}>
            {t('banner.empty')}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => go('/api/demo/end', { next: '/demo' }, `/${locale}/demo`)} className={cn(buttonClass.secondary, 'py-1.5')}>
          {t('banner.restart')}
        </button>
      </div>
      <p className="basis-full text-xs text-muted-foreground">{t(`roles.${role}.hint`)}</p>
    </div>
  );
}
