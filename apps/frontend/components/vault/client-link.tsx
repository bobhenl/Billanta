'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { clientLinkWithKey } from '@faktur/cz-compliance';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { storeRekeyedInvoice } from '@/lib/vault/actions';
import { clientLinkKey, type SealedDocument } from '@/lib/vault/content';
import { useVault } from './vault-provider';

export type ClientLinkState = 'plain' | 'locked' | 'loading' | 'ready' | 'prepare' | 'failed';

/**
 * The client link of a sealed document with its key after `#`, built in
 * this browser. `withKey(url)` adds the fragment; nothing here sends the key
 * anywhere. A document sealed before document keys ("prepare") first has
 * its texts re-encrypted under one key of its own, which stores only
 * ciphertext on the server.
 */
export function useClientLinkKey(invoiceId: string, doc: SealedDocument | null) {
  const { key, requestUnlock } = useVault();
  const router = useRouter();
  const [state, setState] = useState<ClientLinkState>(doc ? 'loading' : 'plain');
  const [raw, setRaw] = useState<Uint8Array | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof clientLinkKey>>>(null);
  const docJson = doc ? JSON.stringify(doc) : null;

  useEffect(() => {
    setRaw(null);
    setPending(null);
    if (!docJson) return setState('plain');
    if (!key) return setState('locked');
    let live = true;
    setState('loading');
    clientLinkKey(key, JSON.parse(docJson) as SealedDocument)
      .then((result) => {
        if (!live) return;
        if (!result) return setState('plain');
        setPending(result);
        if (result.rekey) return setState('prepare');
        setRaw(result.docKey.raw);
        setState('ready');
      })
      .catch(() => live && setState('failed'));
    return () => {
      live = false;
    };
  }, [key, docJson]);

  const prepare = async () => {
    if (!pending?.rekey) return;
    setState('loading');
    const stored = await storeRekeyedInvoice(invoiceId, pending.rekey);
    if (!stored.ok) return setState('failed');
    setRaw(pending.docKey.raw);
    setState('ready');
    router.refresh();
  };

  return {
    state,
    unlock: () => void requestUnlock(),
    prepare,
    withKey: (url: string) => (raw ? clientLinkWithKey(url, raw) : url)
  };
}

/** What the link next to it carries, and the button to make it carry the key. */
export function ClientLinkNotice({ link, serverEmail = false, className }: { link: ReturnType<typeof useClientLinkKey>; serverEmail?: boolean; className?: string }) {
  const t = useTranslations('vault.clientLink');
  if (link.state === 'plain') return null;
  return (
    <div className={cn('space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground', className)}>
      <p className="flex items-start gap-1.5">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span>
          {link.state === 'ready' ? t('ready') : link.state === 'locked' ? t('locked') : link.state === 'prepare' ? t('prepare') : link.state === 'failed' ? t('failed') : t('loading')}
        </span>
      </p>
      {link.state === 'locked' && (
        <button type="button" onClick={link.unlock} className="font-semibold text-primary hover:underline">
          {t('unlock')}
        </button>
      )}
      {(link.state === 'prepare' || link.state === 'failed') && (
        <button type="button" onClick={() => void link.prepare()} className="font-semibold text-primary hover:underline">
          {t('prepareButton')}
        </button>
      )}
      {link.state === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      {link.state === 'ready' && <p>{t('shareOnly')}</p>}
      {serverEmail && <p>{t('serverEmail')}</p>}
    </div>
  );
}
