'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DEMO_KINDS, type DemoKind } from '@/lib/demo';
import { cn } from '@/lib/utils';

const COUNTRY: Record<DemoKind, 'CZ' | 'SK'> = { cz_vat_sro: 'CZ', cz_freelancer: 'CZ', cz_pausal: 'CZ', sk_vat_sro: 'SK' };

/**
 * Four cards, one per demo company. A click asks /api/demo/start for a fresh
 * company and then loads the dashboard with a full page load, so the new
 * session cookie is the one every server component sees.
 */
export function DemoKindPicker({ locale }: { locale: string }) {
  const t = useTranslations('demo');
  const [busy, setBusy] = useState<DemoKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Slovak visitors look for the Slovak company first.
  const kinds = locale === 'sk' ? [...DEMO_KINDS].sort((a, b) => Number(COUNTRY[b] === 'SK') - Number(COUNTRY[a] === 'SK')) : DEMO_KINDS;

  async function start(kind: DemoKind) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch('/api/demo/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, locale })
      });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (res.ok && data.redirect) {
        window.location.assign(data.redirect);
        return;
      }
      const code = data.error && t.has(`errors.${data.error}`) ? data.error : 'demo_unavailable';
      setError(t(`errors.${code}`));
    } catch {
      setError(t('errors.demo_unavailable'));
    }
    setBusy(null);
  }

  return (
    <div className="mt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={busy !== null}
            onClick={() => start(kind)}
            className={cn(
              'group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors',
              'hover:border-primary/50 hover:bg-accent disabled:cursor-wait disabled:opacity-60',
              busy === kind && 'border-primary'
            )}
          >
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">{t(`country.${COUNTRY[kind]}`)}</span>
            <span className="text-base font-semibold">{t(`kinds.${kind}.title`)}</span>
            <span className="text-sm text-muted-foreground">{t(`kinds.${kind}.description`)}</span>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-bold text-primary">
              {busy === kind ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('starting')}
                </>
              ) : (
                <>
                  {t('start')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </>
              )}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
