'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * The Content-Security-Policy this page was served with, read from a fresh
 * request for the same URL, so the page quotes the real header rather than
 * a copy of next.config.mjs that could drift.
 */
export function LiveCsp() {
  const t = useTranslations('vaultPublic.csp');
  const [policy, setPolicy] = useState<string | null | 'none'>(null);

  useEffect(() => {
    fetch(window.location.pathname, { method: 'HEAD', cache: 'no-store' })
      .then((r) => setPolicy(r.headers.get('content-security-policy') ?? 'none'))
      .catch(() => setPolicy('none'));
  }, []);

  if (policy === null) return null;
  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('liveTitle')}</p>
      {policy === 'none' ? (
        <p className="mt-1 text-sm text-muted-foreground">{t('liveMissing')}</p>
      ) : (
        <code className="mt-1 block break-all font-mono text-xs">{policy}</code>
      )}
    </div>
  );
}
