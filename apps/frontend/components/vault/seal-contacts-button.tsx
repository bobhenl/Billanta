'use client';

import { useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { fetchPlainContacts, storeSealedContacts } from '@/lib/vault/actions';
import { sealContactBatch, sealsContacts } from '@/lib/vault/contacts';
import { buttonClass } from '@/lib/ui-classes';
import { useVault } from './vault-provider';

/**
 * "Zašifrovat stávající kontakty": encrypts the contacts stored before
 * "Kontakty" was on, then the buyer copied onto each of their documents.
 * Batch by batch, so closing the tab halfway loses nothing and a second run
 * continues. The server writes a contact only while its name is still
 * plain, so a retry or a second tab can't overwrite one. Locked documents
 * are left out by the server.
 */
export function SealContactsButton() {
  const t = useTranslations('vault.sealContacts');
  const router = useRouter();
  const { vault, requestUnlock } = useVault();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  if (!sealsContacts(vault)) return null;

  const run = async () => {
    const key = await requestUnlock();
    if (!key) return;
    setBusy(true);
    setDone(0);
    let total = 0;
    try {
      // Each round asks for what is still plain; a round that seals nothing ends the loop.
      for (;;) {
        const batch = await fetchPlainContacts();
        if (!batch.ok) throw new Error(batch.error);
        if (!batch.value.contacts.length && !batch.value.invoices.length) break;
        const stored = await storeSealedContacts(await sealContactBatch(key, batch.value));
        if (!stored.ok) throw new Error(stored.error);
        const sealed = stored.value.contacts + stored.value.invoices;
        total += stored.value.contacts;
        setDone(total);
        if (sealed === 0) break;
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
        <Users className="h-4 w-4" aria-hidden="true" />
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
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
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
