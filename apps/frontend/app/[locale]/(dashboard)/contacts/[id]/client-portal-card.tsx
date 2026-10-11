'use client';

import { useEffect, useState, useTransition } from 'react';
import { Copy, ExternalLink, Globe, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { setContactPortal } from '../actions';

/** The customer's portal link (all their documents on one page): turn on, copy, renew, turn off. */
export function ClientPortalCard({ contactId, token }: { contactId: string; token: string | null }) {
  const t = useTranslations('contacts.detail.portal');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const url = token ? `${origin}/${locale}/c/${token}` : '';

  const set = (enabled: boolean, okText: string) =>
    startTransition(async () => {
      const r = await setContactPortal(contactId, enabled);
      if (!r.ok) {
        toast({ text: t('failed'), tone: 'err' });
        return;
      }
      toast({ text: okText, tone: 'ok' });
      router.refresh();
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    }
  };

  const small =
    'inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-accent hover:text-primary disabled:opacity-50';

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-sm">
      <InfoHint hint={t('hint')} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <h2 className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" />
          {t('title')}
        </h2>
      </InfoHint>
      {token ? (
        <>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('title')}
            className="mt-3 h-9 w-full rounded-lg border border-input bg-background px-2.5 font-mono text-xs"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={copy} className={small}>
              <Copy className="h-3.5 w-3.5" />
              {t('copy')}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className={small}>
              <ExternalLink className="h-3.5 w-3.5" />
              {t('open')}
            </a>
            <button type="button" disabled={pending} onClick={() => window.confirm(t('renewConfirm')) && set(true, t('renewed'))} className={small}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('renew')}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => set(false, t('disabled'))}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              {t('disable')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-muted-foreground">{t('off')}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => set(true, t('enabled'))}
            className="mt-3 rounded-full bg-primary px-3.5 py-1.5 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {t('enable')}
          </button>
        </>
      )}
    </section>
  );
}
