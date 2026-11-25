'use client';

import { useTransition } from 'react';
import { EyeOff, FilePlus2, Link2, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import type { TransactionStatus } from '@/lib/bank-ui';
import { draftInvoiceFromTransaction, ignoreTransaction, matchTransaction, restoreTransaction, type ActionResult } from '../actions';

/**
 * Header actions (ignore / restore) or, with `matchInvoiceId`, the
 * "Spárovat" button of one suggested invoice (`matchPaid`: it is already
 * paid and only gets linked), or with `createDraft` the "Vytvořit fakturu
 * z platby" button.
 */
export function TransactionActions({
  id,
  status,
  matchInvoiceId,
  matchPaid,
  createDraft
}: {
  id: string;
  status: TransactionStatus;
  matchInvoiceId?: string;
  matchPaid?: boolean;
  createDraft?: boolean;
}) {
  const t = useTranslations('bank.detail');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const canEdit = useCanWrite('bank');

  const run = (fn: () => Promise<ActionResult>, done: string) =>
    startTransition(async () => {
      const result = await fn();
      const failure = !result.ok && result.error === 'invoice_already_linked' ? t('alreadyLinked') : `${t('actionFailed')}: ${result.ok ? '' : result.error}`;
      toast(result.ok ? { text: done, tone: 'ok' } : { text: failure, tone: 'err' });
      router.refresh();
    });

  // Matching, ignoring and restoring all change the statement line.
  if (!canEdit) return null;

  const spin = pending && <Loader2 className="h-4 w-4 animate-spin" />;

  if (createDraft) {
    return (
      <button
        type="button"
        className={buttonClass.secondary}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await draftInvoiceFromTransaction(id);
            if (!result.ok) {
              toast({ text: `${t('actionFailed')}: ${result.error}`, tone: 'err' });
              return;
            }
            // A draft to review, never issued: open it so the member checks and issues it.
            toast({ text: t('draftDone'), tone: 'ok' });
            router.push(`/invoices/${result.invoiceId}`);
          })
        }
      >
        {spin || <FilePlus2 className="h-4 w-4" />}
        {t('createDraft')}
      </button>
    );
  }
  if (matchInvoiceId) {
    return (
      <button
        type="button"
        className={buttonClass.primary}
        disabled={pending}
        onClick={() => run(() => matchTransaction(id, matchInvoiceId), t(matchPaid ? 'linkedDone' : 'matchedDone'))}
      >
        {spin || <Link2 className="h-4 w-4" />}
        {t('match')}
      </button>
    );
  }
  if (status === 'unmatched') {
    return (
      <button type="button" className={buttonClass.secondary} disabled={pending} onClick={() => run(() => ignoreTransaction(id), t('ignoredDone'))}>
        {spin || <EyeOff className="h-4 w-4" />}
        {t('ignore')}
      </button>
    );
  }
  if (status === 'ignored') {
    return (
      <button type="button" className={buttonClass.secondary} disabled={pending} onClick={() => run(() => restoreTransaction(id), t('restoredDone'))}>
        {spin || <RotateCcw className="h-4 w-4" />}
        {t('restore')}
      </button>
    );
  }
  return null;
}
