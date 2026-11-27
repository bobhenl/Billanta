'use client';

import { useState } from 'react';
import { Coins, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { generateDocumentKey, unwrapDocumentKey, type VaultKey } from '@faktur/cz-compliance';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { fetchPlainAmounts, storeSealedAmounts } from '@/lib/vault/actions';
import { sealPlainAmounts, sealsAmounts, type PlainAmountsDocument } from '@/lib/vault/amounts';
import { buttonClass } from '@/lib/ui-classes';
import { useVault } from './vault-provider';

/** The key the document's sealed texts already use, so a client link opens texts and amounts alike. */
async function keyFor(key: VaultKey, doc: PlainAmountsDocument) {
  if (doc.documentKeyWrap) {
    try {
      return await unwrapDocumentKey(key, doc.documentKeyWrap);
    } catch {
      // A wrap this company key can't open: the server refuses mixed keys, so the document is skipped.
    }
  }
  return generateDocumentKey(key);
}

/**
 * "Zašifrovat částky": encrypts the amounts of documents stored before
 * "Částky" was on. Batch by batch, so closing the tab halfway loses
 * nothing and a second run continues. The server writes a document only
 * while its amounts are still plain and it is not locked. What was paid
 * goes along as one sealed payment of the document.
 */
export function SealAmountsButton() {
  const t = useTranslations('vault.sealAmounts');
  const router = useRouter();
  const { vault, requestUnlock } = useVault();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  if (!sealsAmounts(vault)) return null;

  const run = async () => {
    const key = await requestUnlock();
    if (!key) return;
    setBusy(true);
    setDone(0);
    let total = 0;
    try {
      // Each round asks for what is still plain; a round that seals nothing ends the loop.
      for (;;) {
        const batch = await fetchPlainAmounts();
        if (!batch.ok) throw new Error(batch.error);
        if (!batch.value.invoices.length) break;
        const sealed = await Promise.all(batch.value.invoices.map(async (doc) => sealPlainAmounts(await keyFor(key, doc), doc)));
        const stored = await storeSealedAmounts(sealed);
        if (!stored.ok) throw new Error(stored.error);
        total += stored.value.sealed;
        setDone(total);
        if (stored.value.sealed === 0) break;
      }
      toast({ text: total ? t('done', { n: total }) : t('nothing'), tone: 'ok' });
      setConfirm(false);
      router.refresh();
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setConfirm(true)} className={buttonClass.secondary}>
        <Coins className="h-4 w-4" aria-hidden="true" />
        {t('button')}
      </button>
      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title={t('title')}
        footer={
          <>
            <button type="button" onClick={() => setConfirm(false)} disabled={busy} className={buttonClass.secondary}>
              {t('cancel')}
            </button>
            <button type="button" onClick={run} disabled={busy} className={buttonClass.primary}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Coins className="h-4 w-4" aria-hidden="true" />}
              {busy ? t('progress', { n: done }) : t('confirm')}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-muted-foreground">{t('what')}</p>
          <p className="text-muted-foreground">{t('keeps')}</p>
          <p className="text-muted-foreground">{t('loses')}</p>
          <p className="text-xs text-muted-foreground">{t('resumable')}</p>
        </div>
      </Modal>
    </>
  );
}
