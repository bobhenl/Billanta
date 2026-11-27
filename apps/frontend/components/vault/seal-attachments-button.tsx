'use client';

import { useState } from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { fetchPlainAttachments } from '@/lib/vault/actions';
import { encryptedUpload, encryptsFiles } from '@/lib/vault/files';
import type { PlainAttachment } from '@/lib/vault/types';
import { buttonClass } from '@/lib/ui-classes';
import { useVault } from './vault-provider';

const fileUrl = (f: PlainAttachment) => `/api/files/${f.kind === 'invoice' ? 'invoices' : 'expenses'}/${f.parentId}/attachments/${f.id}`;

/**
 * "Zašifrovat stávající přílohy": downloads each file still stored readable,
 * encrypts it here and uploads the ciphertext in its place. Batch by batch,
 * so closing the tab halfway loses nothing and a second run continues.
 * Attachments of locked documents are left out by the server.
 */
export function SealAttachmentsButton() {
  const t = useTranslations('vault.sealFiles');
  const router = useRouter();
  const { vault, requestUnlock } = useVault();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  if (!encryptsFiles(vault)) return null;

  const run = async () => {
    const key = await requestUnlock();
    if (!key) return;
    setBusy(true);
    setDone(0);
    let total = 0;
    let failed = 0;
    // A file that fails once is not retried in this run, so the loop always ends.
    const skipped = new Set<string>();
    try {
      for (;;) {
        const batch = await fetchPlainAttachments();
        if (!batch.ok) throw new Error(batch.error);
        const todo = batch.value.files.filter((f) => !skipped.has(f.id));
        if (!todo.length) break;
        for (const f of todo) {
          try {
            const res = await fetch(fileUrl(f));
            if (!res.ok) throw new Error(String(res.status));
            const blob = new Blob([await res.arrayBuffer()], { type: f.mime });
            const put = await fetch(`/api/vault/attachments/${f.kind}/${f.id}`, { method: 'PUT', body: await encryptedUpload(key, blob, f.filename) });
            const json = (await put.json().catch(() => ({}))) as { sealed?: number };
            if (!put.ok || !json.sealed) throw new Error(String(put.status));
            total++;
            setDone(total);
          } catch {
            skipped.add(f.id);
            failed++;
          }
        }
      }
      toast({ text: failed ? t('partial', { n: total, failed }) : total ? t('done', { n: total }) : t('nothing'), tone: failed ? 'err' : 'ok' });
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
        <Paperclip className="h-4 w-4" aria-hidden="true" />
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
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
              {busy ? t('progress', { n: done }) : t('confirm')}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-muted-foreground">{t('what')}</p>
          <p className="text-muted-foreground">{t('loses')}</p>
          <p className="text-xs text-muted-foreground">{t('resumable')}</p>
        </div>
      </Modal>
    </>
  );
}
