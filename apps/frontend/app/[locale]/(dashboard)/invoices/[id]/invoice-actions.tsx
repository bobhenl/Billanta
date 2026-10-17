'use client';

import { useState, useTransition } from 'react';
import {
  Ban,
  BellRing,
  BookmarkPlus,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FilePlus2,
  Pencil,
  Repeat2,
  RotateCcw,
  Send,
  Stamp,
  Trash2,
  Undo2
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass, Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { CONVERSIONS, type DocumentType, type InvoiceStatus } from '@/lib/invoice-ui';
import {
  cancelInvoice,
  convertInvoice,
  deleteInvoice,
  issueInvoice,
  markInvoicePaid,
  markInvoiceUnpaid,
  rotateInvoiceLink,
  saveInvoiceAsTemplate,
  sendInvoice,
  sendReminder,
  type ActionResult
} from '../actions';

type Dialog = null | 'issue' | 'paid' | 'cancel' | 'delete' | 'template' | 'send' | 'remind' | 'edit' | 'rotate';

/**
 * Everything one can do with a document, shown according to its state —
 * the toolbar of the invoice detail (after Fakturoid's/iDoklad's detail).
 */
export function InvoiceActions({
  id,
  documentType,
  status,
  numbered,
  hasEmail,
  publicToken,
  defaultTemplateName,
  overdue = false,
  reminderCount = 0,
  total = 0,
  amountPaid = 0,
  currency = 'CZK',
  sentAt = null,
  editedAfterSend = false
}: {
  id: string;
  documentType: DocumentType;
  status: InvoiceStatus;
  numbered: boolean;
  hasEmail: boolean;
  publicToken: string;
  defaultTemplateName: string;
  overdue?: boolean;
  reminderCount?: number;
  total?: number;
  amountPaid?: number;
  currency?: string;
  sentAt?: string | null;
  /** Edited in place after the last send: the customer has an older copy. */
  editedAfterSend?: boolean;
}) {
  const t = useTranslations('doc');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [templateName, setTemplateName] = useState(defaultTemplateName);
  const locale = useLocale();
  const fmt = (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  const remaining = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const [payMode, setPayMode] = useState<'full' | 'partial'>('full');
  const [payUnit, setPayUnit] = useState<'amount' | 'percent'>('amount');
  const [payValue, setPayValue] = useState('');
  const payNumber = Number(payValue.replace(',', '.')) || 0;
  const payAmount = payMode === 'full' ? undefined : Math.round((payUnit === 'percent' ? (total * payNumber) / 100 : payNumber) * 100) / 100;
  const payInvalid = payMode === 'partial' && !(payAmount && payAmount > 0);
  // Provider fees (PayPal, Stripe, Wise…) and the CZK actually credited → net margin on the detail.
  const [feeValue, setFeeValue] = useState('');
  const [editReason, setEditReason] = useState('');
  const [receivedValue, setReceivedValue] = useState('');
  const num = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.')) || undefined;
  const net = { fee: num(feeValue), receivedCzk: currency === 'CZK' ? undefined : num(receivedValue) };

  const isDraft = status === 'draft' || status === 'pending_review';
  const canPay = status === 'issued' && documentType !== 'quote';
  const conversions = status === 'cancelled' || (!numbered && documentType !== 'quote') ? [] : CONVERSIONS[documentType];

  const act = <T,>(fn: () => Promise<ActionResult<T>>, okText: string, after?: (data: T) => void) =>
    startTransition(async () => {
      const result = await fn();
      setDialog(null);
      if (!result.ok) {
        toast({ text: `${t('actionFailed')}: ${result.error}`, tone: 'err' });
        return;
      }
      toast({ text: okText, tone: 'ok' });
      if (after) after(result.data);
      else router.refresh();
    });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isDraft && (
          <>
            <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => setDialog('issue')}>
              <Stamp className="h-4 w-4" />
              {documentType === 'quote' ? t('actions.issueQuote') : t('actions.issue')}
            </button>
            <Link href={`/invoices/${id}/edit`} className={buttonClass.secondary}>
              <Pencil className="h-4 w-4" />
              {t('actions.edit')}
            </Link>
          </>
        )}
        {/* An issued document is final by law, but people still look for
            "edit" on it: the button explains that and offers the right fix. */}
        {!isDraft && numbered && status !== 'cancelled' && (
          <button type="button" className={buttonClass.secondary} onClick={() => setDialog('edit')}>
            <Pencil className="h-4 w-4" />
            {t('actions.edit')}
          </button>
        )}
        {canPay && (
          <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => setDialog('paid')}>
            <CheckCircle2 className="h-4 w-4" />
            {t('actions.markPaid')}
          </button>
        )}
        {status === 'paid' && (
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={pending}
            onClick={() => act(() => markInvoiceUnpaid(id), t('done.unpaid'))}
          >
            <Undo2 className="h-4 w-4" />
            {t('actions.markUnpaid')}
          </button>
        )}
        {numbered && (
          <>
            <a href={`/api/files/invoices/${id}/pdf`} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
              <Download className="h-4 w-4" />
              PDF
            </a>
            <a href={`/api/files/invoices/${id}/isdoc`} className={buttonClass.secondary}>
              <FileCode2 className="h-4 w-4" />
              ISDOC
            </a>
            {documentType === 'invoice' && (
              <a href={`/api/files/invoices/${id}/ubl`} title={t('actions.ublHint')} className={buttonClass.secondary}>
                <FileCode2 className="h-4 w-4" />
                UBL
              </a>
            )}
          </>
        )}
        {numbered && status !== 'cancelled' && (
          <button type="button" className={buttonClass.secondary} disabled={pending || !hasEmail} title={hasEmail ? undefined : t('noEmail')} onClick={() => setDialog('send')}>
            <Send className="h-4 w-4" />
            {t('actions.send')}
          </button>
        )}
        {canPay && overdue && (
          <button type="button" className={buttonClass.secondary} disabled={pending || !hasEmail} title={hasEmail ? undefined : t('noEmail')} onClick={() => setDialog('remind')}>
            <BellRing className="h-4 w-4" />
            {t('actions.remind')}
          </button>
        )}
        {conversions.map((to) => (
          <button
            key={to}
            type="button"
            className={buttonClass.secondary}
            disabled={pending}
            onClick={() => act(() => convertInvoice(id, to), t('done.converted'), (doc) => router.push(`/invoices/${doc.id}`))}
          >
            <Repeat2 className="h-4 w-4" />
            {t(`actions.convertTo.${to}`)}
          </button>
        ))}
        <Link href={`/invoices/new?from=${id}`} className={buttonClass.ghost}>
          <Copy className="h-4 w-4" />
          {t('actions.duplicate')}
        </Link>
        {/* Same copy, but the due date follows the default term ("Podle faktury" in the new-invoice form). */}
        {documentType !== 'credit_note' && (
          <Link href={`/invoices/new?from=${id}&similar=1`} className={buttonClass.ghost}>
            <FilePlus2 className="h-4 w-4" />
            {t('actions.issueSimilar')}
          </Link>
        )}
        <button type="button" className={buttonClass.ghost} onClick={() => setDialog('template')}>
          <BookmarkPlus className="h-4 w-4" />
          {t('actions.saveTemplate')}
        </button>
        {numbered && (
          <a href={`/i/${publicToken}?preview=1`} target="_blank" rel="noreferrer" className={buttonClass.ghost}>
            <ExternalLink className="h-4 w-4" />
            {t('actions.publicLink')}
          </a>
        )}
        {numbered && (
          <button type="button" className={buttonClass.ghost} onClick={() => setDialog('rotate')}>
            <RotateCcw className="h-4 w-4" />
            {t('actions.rotateLink')}
          </button>
        )}
        {status === 'issued' && (
          <button type="button" className={buttonClass.ghost} onClick={() => setDialog('cancel')}>
            <Ban className="h-4 w-4" />
            {t('actions.cancel')}
          </button>
        )}
        {isDraft && (
          <button type="button" className={`${buttonClass.ghost} hover:text-destructive`} onClick={() => setDialog('delete')}>
            <Trash2 className="h-4 w-4" />
            {t('actions.delete')}
          </button>
        )}
      </div>

      {editedAfterSend && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="min-w-0">
            <p className="font-semibold">{t('correction.title')}</p>
            <p className="text-muted-foreground">{t('correction.body', { date: sentAt ? new Date(sentAt).toLocaleDateString(locale) : '' })}</p>
          </div>
          <button type="button" className={buttonClass.primary} disabled={pending || !hasEmail} title={hasEmail ? undefined : t('noEmail')} onClick={() => setDialog('send')}>
            <Send className="h-4 w-4" />
            {t('correction.send')}
          </button>
        </div>
      )}

      <Modal
        open={dialog === 'issue'}
        onClose={() => setDialog(null)}
        title={t('confirm.issueTitle')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setDialog(null)}>
              {t('confirm.back')}
            </button>
            <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => act(() => issueInvoice(id), t('done.issued'))}>
              {t('actions.issue')}
            </button>
          </>
        }
      >
        <p className="text-muted-foreground">{t('confirm.issueBody')}</p>
      </Modal>

      <Modal
        open={dialog === 'paid'}
        onClose={() => setDialog(null)}
        title={payMode === 'partial' ? t('partial.record') : t('confirm.paidTitle')}
        footer={
          <button
            type="button"
            className={buttonClass.primary}
            disabled={pending || payInvalid}
            onClick={() => act(() => markInvoicePaid(id, paidAt, payAmount, net), payAmount && payAmount < remaining ? t('done.partial') : t('done.paid'))}
          >
            {payMode === 'full' ? t('actions.markPaid') : t('partial.record')}
          </button>
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          {(['full', 'partial'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPayMode(m)}
              className={`rounded-lg border px-3 py-2 font-semibold ${payMode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {m === 'full' ? t('partial.full', { amount: fmt(remaining) }) : t('partial.partial')}
            </button>
          ))}
        </div>
        {payMode === 'partial' && (
          <div className="mb-3">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('partial.amountLabel')}</span>
            <div className="flex gap-2">
              <input className={inputClass} inputMode="decimal" autoFocus value={payValue} onChange={(e) => setPayValue(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={payUnit === 'percent' ? '50' : String(remaining)} />
              <select className={`${inputClass} w-24`} value={payUnit} onChange={(e) => setPayUnit(e.target.value as 'amount' | 'percent')}>
                <option value="amount">{currency}</option>
                <option value="percent">%</option>
              </select>
            </div>
            {payUnit === 'percent' && payAmount ? <p className="mt-1 text-xs text-muted-foreground">= {fmt(payAmount)}</p> : null}
            {amountPaid > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('partial.alreadyPaid', { amount: fmt(amountPaid) })}</p>}
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('fields.paidAt')}</span>
          <input type="date" className={inputClass} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </label>
        <details className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold text-muted-foreground">{t('net.toggle')}</summary>
          <p className="mt-1 text-xs text-muted-foreground">{t('net.hint')}</p>
          <div className={`mt-2 grid gap-2 ${currency === 'CZK' ? '' : 'sm:grid-cols-2'}`}>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('net.fee', { currency })}</span>
              <input className={inputClass} inputMode="decimal" value={feeValue} onChange={(e) => setFeeValue(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" />
            </label>
            {currency !== 'CZK' && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('net.received')}</span>
                <input className={inputClass} inputMode="decimal" value={receivedValue} onChange={(e) => setReceivedValue(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="CZK" />
              </label>
            )}
          </div>
        </details>
      </Modal>

      <Modal
        open={dialog === 'send'}
        onClose={() => setDialog(null)}
        title={editedAfterSend ? t('correction.title') : t('confirm.sendTitle')}
        footer={
          <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => act(() => sendInvoice(id), t('done.sent'))}>
            <Send className="h-4 w-4" />
            {editedAfterSend ? t('correction.send') : t('actions.send')}
          </button>
        }
      >
        <p className="text-muted-foreground">{editedAfterSend ? t('correction.sendBody') : t('confirm.sendBody')}</p>
      </Modal>

      <Modal
        open={dialog === 'remind'}
        onClose={() => setDialog(null)}
        title={t('confirm.remindTitle')}
        footer={
          <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => act(() => sendReminder(id), t('done.reminded'))}>
            <BellRing className="h-4 w-4" />
            {t('actions.remind')}
          </button>
        }
      >
        <p className="text-muted-foreground">{t('confirm.remindBody', { count: reminderCount + 1 })}</p>
      </Modal>

      <Modal
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
        title={t('confirm.editIssuedTitle')}
        footer={
          <>
            <Link href={`/invoices/new?from=${id}`} className={buttonClass.secondary}>
              <Copy className="h-4 w-4" />
              {t('actions.duplicateToFix')}
            </Link>
            {documentType === 'invoice' && (
              <button
                type="button"
                className={buttonClass.primary}
                disabled={pending}
                onClick={() => act(() => convertInvoice(id, 'credit_note'), t('done.converted'), (doc) => router.push(`/invoices/${doc.id}`))}
              >
                <Repeat2 className="h-4 w-4" />
                {t('actions.convertTo.credit_note')}
              </button>
            )}
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={!editReason.trim()}
              title={editReason.trim() ? undefined : t('confirm.editAnywayNeedsReason')}
              onClick={() => router.push(`/invoices/${id}/edit?issued=1&reason=${encodeURIComponent(editReason.trim())}`)}
            >
              <Pencil className="h-4 w-4" />
              {t('actions.editAnyway')}
            </button>
          </>
        }
      >
        <p className="text-muted-foreground">{t('confirm.editIssuedBody')}</p>
        {sentAt && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t('correction.editNote', { date: new Date(sentAt).toLocaleDateString(locale) })}</p>}
        {documentType === 'invoice' && <p className="mt-2 text-muted-foreground">{t('confirm.editIssuedCredit')}</p>}
        {/* Typos and similar: edit in place, but the reason and every change go to the history. */}
        <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-sm font-semibold">{t('confirm.editAnywayTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('confirm.editAnywayBody')}</p>
          <textarea
            className={`${inputClass} mt-2 min-h-[4.5rem]`}
            value={editReason}
            maxLength={1000}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder={t('confirm.editAnywayPlaceholder')}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'rotate'}
        onClose={() => setDialog(null)}
        title={t('confirm.rotateTitle')}
        footer={
          <button type="button" className={buttonClass.danger} disabled={pending} onClick={() => act(() => rotateInvoiceLink(id), t('done.rotated'))}>
            {t('actions.rotateLink')}
          </button>
        }
      >
        <p className="text-muted-foreground">{t('confirm.rotateBody')}</p>
      </Modal>

      <Modal
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={t('confirm.cancelTitle')}
        footer={
          <>
            {documentType === 'invoice' && (
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={pending}
                onClick={() => act(() => convertInvoice(id, 'credit_note'), t('done.converted'), (doc) => router.push(`/invoices/${doc.id}`))}
              >
                {t('actions.convertTo.credit_note')}
              </button>
            )}
            <button type="button" className={buttonClass.danger} disabled={pending} onClick={() => act(() => cancelInvoice(id), t('done.cancelled'))}>
              {t('actions.cancel')}
            </button>
          </>
        }
      >
        <p className="text-muted-foreground">{t('confirm.cancelBody')}</p>
      </Modal>

      <Modal
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={t('confirm.deleteTitle')}
        footer={
          <button
            type="button"
            className={buttonClass.danger}
            disabled={pending}
            onClick={() => act(() => deleteInvoice(id), t('done.deleted'), () => router.push('/invoices'))}
          >
            <Trash2 className="h-4 w-4" />
            {t('actions.delete')}
          </button>
        }
      >
        <p className="text-muted-foreground">{t('confirm.deleteBody')}</p>
      </Modal>

      <Modal
        open={dialog === 'template'}
        onClose={() => setDialog(null)}
        title={t('actions.saveTemplate')}
        footer={
          <button
            type="button"
            className={buttonClass.primary}
            disabled={pending || !templateName.trim()}
            onClick={() => act(() => saveInvoiceAsTemplate(id, templateName.trim()), t('done.templateSaved'), () => router.push('/invoices/templates'))}
          >
            <BookmarkPlus className="h-4 w-4" />
            {t('confirm.save')}
          </button>
        }
      >
        <p className="mb-3 text-muted-foreground">{t('confirm.templateBody')}</p>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('confirm.templateName')}</span>
          <input className={inputClass} value={templateName} maxLength={120} onChange={(e) => setTemplateName(e.target.value)} />
        </label>
      </Modal>
    </>
  );
}
