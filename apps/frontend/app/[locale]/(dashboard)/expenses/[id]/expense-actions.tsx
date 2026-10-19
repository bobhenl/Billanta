'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Copy, Pencil, Trash2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass, Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import { deleteExpense, setExpensePaid, type ActionResult } from '../actions';

/** Toolbar of the expense detail (every action changes the expense, so none for a read-only member). */
export function ExpenseActions({ id, paid }: { id: string; paid: boolean }) {
  const t = useTranslations('expenses.detail');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<null | 'paid' | 'delete'>(null);
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const canEdit = useCanWrite('expenses');

  const act = (fn: () => Promise<ActionResult<unknown>>, okText: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      setDialog(null);
      if (!result.ok) {
        toast({ text: `${t('actionFailed')}: ${result.error}`, tone: 'err' });
        return;
      }
      toast({ text: okText, tone: 'ok' });
      if (after) after();
      else router.refresh();
    });

  if (!canEdit) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {paid ? (
          <button type="button" className={buttonClass.secondary} disabled={pending} onClick={() => act(() => setExpensePaid(id, null), t('done.unpaid'))}>
            <Undo2 className="h-4 w-4" />
            {t('markUnpaid')}
          </button>
        ) : (
          <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => setDialog('paid')}>
            <CheckCircle2 className="h-4 w-4" />
            {t('markPaid')}
          </button>
        )}
        <Link href={`/expenses/${id}/edit`} className={buttonClass.secondary}>
          <Pencil className="h-4 w-4" />
          {t('edit')}
        </Link>
        <Link href={`/expenses/new?from=${id}`} className={buttonClass.ghost}>
          <Copy className="h-4 w-4" />
          {t('duplicate')}
        </Link>
        <button type="button" className={`${buttonClass.ghost} hover:text-destructive`} onClick={() => setDialog('delete')}>
          <Trash2 className="h-4 w-4" />
          {t('delete')}
        </button>
      </div>

      <Modal
        open={dialog === 'paid'}
        onClose={() => setDialog(null)}
        title={t('markPaid')}
        footer={
          <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => act(() => setExpensePaid(id, paidAt), t('done.paid'))}>
            {t('markPaid')}
          </button>
        }
      >
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('paidAt')}</span>
          <input type="date" className={inputClass} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </label>
      </Modal>

      <Modal
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={t('deleteTitle')}
        footer={
          <button
            type="button"
            className={buttonClass.danger}
            disabled={pending}
            onClick={() => act(() => deleteExpense(id), t('done.deleted'), () => router.push('/expenses'))}
          >
            <Trash2 className="h-4 w-4" />
            {t('delete')}
          </button>
        }
      >
        <p className="text-muted-foreground">{t('deleteBody')}</p>
      </Modal>
    </>
  );
}
