'use client';

import { useState } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { fetchPlainInvoices, storeSealedInvoices } from '@/lib/vault/actions';
import { sealPlainInvoice } from '@/lib/vault/content';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { useVault } from './vault-provider';

export type SealScope = { kind: 'invoice'; invoiceId: string } | { kind: 'contact'; contactId: string } | { kind: 'company' };

/**
 * "Zašifrovat": encrypts the texts of existing documents in the browser and
 * stores the envelopes in place, batch by batch. Locked documents are
 * skipped (the server leaves them out). Hidden when the mode is off or the
 * plan is below Plus.
 */
export function SealButton({ scope, className, compact = false }: { scope: SealScope; className?: string; compact?: boolean }) {
  const t = useTranslations('vault.seal');
  const router = useRouter();
  const { vault, requestUnlock } = useVault();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  // Below Plus the vault still opens, but nothing new gets encrypted.
  if (!vault || !vault.categories.includes('texts') || vault.planAllowed === false) return null;

  const filter = scope.kind === 'invoice' ? { invoiceId: scope.invoiceId } : scope.kind === 'contact' ? { contactId: scope.contactId } : {};

  const run = async () => {
    const key = await requestUnlock();
    if (!key) return;
    setBusy(true);
    setDone(0);
    let total = 0;
    try {
      // Each round asks for what is still plain; a round that seals nothing ends the loop.
      for (;;) {
        const batch = await fetchPlainInvoices(filter);
        if (!batch.ok) throw new Error(batch.error);
        if (!batch.value.invoices.length) break;
        const sealed = await Promise.all(batch.value.invoices.map((doc) => sealPlainInvoice(key, doc)));
        const stored = await storeSealedInvoices(sealed);
        if (!stored.ok) throw new Error(stored.error);
        total += stored.value.sealed;
        setDone(total);
        if (stored.value.sealed === 0 || batch.value.remaining <= batch.value.invoices.length) break;
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
      <button type="button" onClick={() => setConfirm(true)} className={cn(compact ? buttonClass.ghost : buttonClass.secondary, className)}>
        <LockKeyhole className="h-4 w-4" aria-hidden="true" />
        {t(`button.${scope.kind}`)}
      </button>
      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title={t(`title.${scope.kind}`)}
        footer={
          <>
            <button type="button" onClick={() => setConfirm(false)} disabled={busy} className={buttonClass.secondary}>
              {t('cancel')}
            </button>
            <button type="button" onClick={run} disabled={busy} className={buttonClass.primary}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
              {busy ? t('progress', { n: done }) : t('confirm')}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="font-semibold">{t('lead')}</p>
          <p className="text-muted-foreground">{t('what')}</p>
          <p className="text-muted-foreground">{t('keeps')}</p>
          <p className="text-muted-foreground">{t('loses')}</p>
          <p className="text-xs text-muted-foreground">{t('locked')}</p>
        </div>
      </Modal>
    </>
  );
}
