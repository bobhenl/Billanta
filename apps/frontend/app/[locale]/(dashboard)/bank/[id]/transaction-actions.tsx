'use client';

import { useTransition } from 'react';
import { EyeOff, Link2, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import type { TransactionStatus } from '@/lib/bank-ui';
import { ignoreTransaction, matchTransaction, restoreTransaction, type ActionResult } from '../actions';

/**
 * Header actions (ignore / restore) or, with `matchInvoiceId`, the
 * "Spárovat" button of one suggested invoice.
 */
export function TransactionActions({ id, status, matchInvoiceId }: { id: string; status: TransactionStatus; matchInvoiceId?: string }) {
  const t = useTranslations('bank.detail');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>, done: string) =>
    startTransition(async () => {
      const result = await fn();
      toast(result.ok ? { text: done, tone: 'ok' } : { text: `${t('actionFailed')}: ${result.error}`, tone: 'err' });
      router.refresh();
    });

  const spin = pending && <Loader2 className="h-4 w-4 animate-spin" />;

  if (matchInvoiceId) {
    return (
      <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => run(() => matchTransaction(id, matchInvoiceId), t('matchedDone'))}>
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
