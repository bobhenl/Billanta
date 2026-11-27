'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { VaultKey } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Link } from '@/i18n/navigation';
import { dismissVaultEmail, fetchVaultEmails, sendVaultEmailPdf, type VaultEmail } from '@/lib/vault/email-actions';
import { renderSealedInvoicePdf } from '@/lib/vault/render-pdf';
import { buttonClass } from '@/lib/ui-classes';
import { useVault } from './vault-provider';

/** Fired after a send that may have queued an e-mail, so the outbox reloads its list. */
export const VAULT_EMAILS_CHANGED = 'billanta:vault-emails';

/** One waiting e-mail, with the PDF drawn in this browser. */
async function sendOne(key: VaultKey, item: VaultEmail) {
  const form = new FormData();
  form.set('pdf', await renderSealedInvoicePdf(key, item.invoiceId), 'invoice.pdf');
  return sendVaultEmailPdf(item.id, form);
}

/**
 * "Důvěrný režim" outbox: e-mails of encrypted documents the server sent
 * without their PDF, or held whole, until a member with the key is here.
 * Shows "N e-mailů čeká na odeslání s PDF" and sends them on a click, with
 * the PDF drawn in this browser (only the finished file passes through).
 * With "Odesílat PDF automaticky" it goes without asking.
 */
export function VaultEmailOutbox({ canSend }: { canSend: boolean }) {
  const t = useTranslations('vault.outbox');
  const { vault, key, requestUnlock } = useVault();
  const [items, setItems] = useState<VaultEmail[]>([]);
  const [autoSend, setAutoSend] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoRan = useRef(false);

  const refresh = useCallback(async () => {
    const result = await fetchVaultEmails();
    if (result.ok) {
      setItems(result.value.items);
      setAutoSend(result.value.autoSendPdf);
    }
  }, []);

  useEffect(() => {
    if (!vault || !canSend) return;
    void refresh();
    const reload = () => void refresh();
    window.addEventListener(VAULT_EMAILS_CHANGED, reload);
    return () => window.removeEventListener(VAULT_EMAILS_CHANGED, reload);
  }, [vault, canSend, refresh]);

  const sendAll = useCallback(
    async (list: VaultEmail[], k: VaultKey | null) => {
      const unlocked = k ?? (await requestUnlock());
      if (!unlocked) return;
      setBusy(true);
      let sent = 0;
      let failed = 0;
      for (const item of list) {
        try {
          const result = await sendOne(unlocked, item);
          if (result.ok) sent++;
          else failed++;
        } catch {
          failed++;
        }
      }
      setBusy(false);
      setDialog(false);
      if (sent) toast({ text: t('sent', { n: sent }), tone: 'ok' });
      if (failed) toast({ text: t('failed', { n: failed }), tone: 'err' });
      await refresh();
    },
    [requestUnlock, refresh, t]
  );

  useEffect(() => {
    if (autoRan.current || !autoSend || !key || items.length === 0) return;
    autoRan.current = true;
    void sendAll(items, key);
  }, [autoSend, key, items, sendAll]);

  const dismiss = async (id: string) => {
    const result = await dismissVaultEmail(id);
    if (!result.ok) toast({ text: t('failed', { n: 1 }), tone: 'err' });
    await refresh();
  };

  if (!vault || !canSend || items.length === 0) return null;

  return (
    <>
      <Banner
        tone="warn"
        title={t('badge', { n: items.length })}
        className="mb-4 items-center"
        action={
          <button type="button" onClick={() => setDialog(true)} className={buttonClass.secondary}>
            {t('open')}
          </button>
        }
      />

      <Modal
        open={dialog}
        onClose={() => !busy && setDialog(false)}
        title={t('title')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => setDialog(false)}>
              {t('back')}
            </button>
            <button type="button" className={buttonClass.primary} disabled={busy} onClick={() => void sendAll(items, key)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {key ? t('send', { n: items.length }) : t('unlockAndSend', { n: items.length })}
            </button>
          </>
        }
      >
        <p className="text-muted-foreground">{t('lead')}</p>
        <p className="mt-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs">{t('passThroughPdf')}</p>
        <ul className="mt-3 divide-y divide-border text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
              <Link href={`/invoices/${item.invoiceId}`} onClick={() => setDialog(false)} className="font-semibold text-primary hover:underline">
                {item.invoiceNumber ?? t('unnumbered')}
              </Link>
              <span className="min-w-0 flex-1 break-all text-muted-foreground">{item.recipient}</span>
              <span className="text-xs text-muted-foreground">{t(`kind.${item.kind}`)}</span>
              <button type="button" disabled={busy} onClick={() => void dismiss(item.id)} className="rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={t('dismiss')} title={t('dismiss')}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('settingsHint')}{' '}
          <Link href="/settings/confidential" onClick={() => setDialog(false)} className="font-semibold text-primary hover:underline">
            {t('settingsLink')}
          </Link>
        </p>
      </Modal>
    </>
  );
}
