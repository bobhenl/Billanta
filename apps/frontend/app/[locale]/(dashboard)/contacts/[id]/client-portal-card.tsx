'use client';

import { useEffect, useState, useTransition } from 'react';
import { ChevronDown, Copy, ExternalLink, Globe, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import { LinkNameField } from '@/components/link-name-field';
import { setContactPortal, setContactPortalName } from '../actions';
import { copyText } from '@/lib/clipboard';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** The customer's portal link (all their documents on one page): turn on, copy, rename, renew, turn off. */
export function ClientPortalCard({
  contactId,
  link,
  defaultLink,
  slug
}: {
  contactId: string;
  link: string | null;
  /** The link without the custom name (customer's name or nothing, per Settings). */
  defaultLink: string | null;
  slug: string | null;
}) {
  const t = useTranslations('contacts.detail.portal');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Copy and open are for everyone; switching, renewing and renaming change the contact.
  const canEdit = useCanWrite('contacts');
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const base = `${origin}/${locale}/c/`;
  const url = link ? `${base}${link}` : '';

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
      await copyText(url);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    }
  };

  const small = cn(buttonClass.secondary, 'h-10');

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-sm">
      <InfoHint hint={t('hint')} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <h2 className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" />
          {t('title')}
        </h2>
      </InfoHint>
      {link ? (
        <>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('title')}
            className={cn(inputClass, 'mt-3 h-10 font-mono text-xs')}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={small}>
              <Copy className="h-4 w-4" />
              {t('copy')}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className={small}>
              <ExternalLink className="h-4 w-4" />
              {t('open')}
            </a>
          </div>
          {/* Renaming, renewing and switching off happen once in a while; copy and open are the daily use. */}
          {canEdit && (
            <details className="group mt-3 border-t border-border pt-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold [&::-webkit-details-marker]:hidden">
                {t('manage')}
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
              </summary>
              <LinkNameField
                className="mt-3"
                base={base}
                link={link}
                defaultLink={defaultLink ?? link}
                slug={slug}
                onSave={(s) => setContactPortalName(contactId, s)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={pending} onClick={() => window.confirm(t('renewConfirm')) && set(true, t('renewed'))} className={small}>
                  <RefreshCw className="h-4 w-4" />
                  {t('renew')}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => set(false, t('disabled'))}
                  className={cn(buttonClass.ghost, 'h-10 hover:text-destructive')}
                >
                  {t('disable')}
                </button>
              </div>
            </details>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-muted-foreground">{t('off')}</p>
          {canEdit && (
          <button
            type="button"
            disabled={pending}
            onClick={() => set(true, t('enabled'))}
            className={cn(buttonClass.secondary, 'mt-3 h-10')}
          >
            {t('enable')}
          </button>
          )}
        </>
      )}
    </section>
  );
}
