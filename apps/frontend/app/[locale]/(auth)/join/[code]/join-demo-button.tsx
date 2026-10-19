'use client';

import { useState } from 'react';
import { Loader2, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BUSINESS_PRESETS } from '@/lib/business-presets';
import type { DemoKind } from '@/lib/demo';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** The demo company closest to the code's business type (the reverse of the demo picker's KIND_PRESET). */
function demoKindFor(preset: string | null, locale: string): DemoKind {
  if (locale === 'sk') return 'sk_vat_sro';
  if (preset === 'flatTax') return 'cz_pausal';
  if (preset === 'tradesman' || preset === 'invoicingOnly') return 'cz_freelancer';
  return 'cz_vat_sro';
}

/**
 * "Just try it": the no-signup demo, set up like the company the code is
 * meant for. The promo cookie stays, so creating an account later still
 * redeems the code.
 */
export function JoinDemoButton({ preset, locale }: { preset: string | null; locale: string }) {
  const t = useTranslations('join');
  const tDemo = useTranslations('demo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/demo/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: demoKindFor(preset, locale),
          locale,
          empty: false,
          modules: BUSINESS_PRESETS.find((p) => p.key === preset)?.modules
        })
      });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (res.ok && data.redirect) {
        window.location.assign(data.redirect);
        return;
      }
      setError(tDemo(`errors.${data.error && tDemo.has(`errors.${data.error}`) ? data.error : 'demo_unavailable'}`));
    } catch {
      setError(tDemo('errors.demo_unavailable'));
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" onClick={start} disabled={busy} className={cn(buttonClass.secondary, 'w-full')}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="h-4 w-4" aria-hidden="true" />}
        {busy ? t('trying') : t('try')}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
