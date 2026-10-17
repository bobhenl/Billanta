'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Clock, Copy, Link2, Send, UserPen, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass, Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import type { BuyerDetailsOutcome } from '@/lib/invoice-ui';
import { cancelBuyerDetails, requestBuyerDetails } from '../actions';

interface Props {
  id: string;
  token: string | null;
  submittedAt: string | null;
  submittedLabel: string | null;
  email: string | null;
  autoIssue: boolean;
  outcome: BuyerDetailsOutcome | null;
  contactEmail: string | null;
}

/**
 * "Odběratel si doplní údaje sám" on a draft: send the customer a link to
 * fill in their own billing details, see whether they did, and what
 * happened with the contact.
 */
export function BuyerDetailsRequest({ id, token, submittedAt, submittedLabel, email, autoIssue, outcome, contactEmail }: Props) {
  const t = useTranslations('invoices.buyerDetails');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(email ?? contactEmail ?? '');
  const [auto, setAuto] = useState(autoIssue);
  const [pending, startTransition] = useTransition();

  const linkOf = (tok: string) => `${window.location.origin}/d/${tok}`;
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      window.prompt(t('copyPrompt'), url);
    }
  };

  const send = () =>
    startTransition(async () => {
      const r = await requestBuyerDetails(id, to, auto);
      if (!r.ok) {
        toast({ text: `${t('failed')}: ${r.error}`, tone: 'err' });
        return;
      }
      setOpen(false);
      if (r.data.emailed) toast({ text: t('emailed', { email: to.trim() }), tone: 'ok' });
      else await copy(linkOf(r.data.token));
      router.refresh();
    });

  const cancel = () =>
    startTransition(async () => {
      const r = await cancelBuyerDetails(id);
      if (!r.ok) toast({ text: `${t('failed')}: ${r.error}`, tone: 'err' });
      else {
        toast({ text: t('cancelled'), tone: 'ok' });
        router.refresh();
      }
    });

  const fieldLabel = (f: string) => (['legalName', 'email', 'ico', 'dic', 'address', 'isPerson', 'contactId'].includes(f) ? t(`field.${f}`) : f);

  const dialog = (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={t('dialogTitle')}
      footer={
        <>
          <button type="button" className={buttonClass.secondary} onClick={() => setOpen(false)}>
            {t('close')}
          </button>
          <button type="button" className={buttonClass.primary} disabled={pending} onClick={send}>
            {to.trim() ? <Send className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            {to.trim() ? t('sendEmail') : t('createLink')}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t('dialogHint')}</p>
      <label className="mt-4 block text-sm">
        <span className="mb-1 block font-medium">{t('emailLabel')}</span>
        <input className={inputClass} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('emailPlaceholder')} maxLength={200} />
        <span className="mt-1 block text-xs text-muted-foreground">{t('emailHint')}</span>
      </label>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>
          <span className="block font-medium">{t('autoIssue')}</span>
          <span className="block text-xs text-muted-foreground">{t('autoIssueHint')}</span>
        </span>
      </label>
      {token && !submittedAt && <p className="mt-4 text-xs text-warning">{t('replaceNote')}</p>}
    </Modal>
  );

  if (submittedAt && outcome) {
    return (
      <div className="mt-4 rounded-xl border border-success/40 bg-success/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('submittedTitle', { date: submittedLabel ?? '' })}</p>
            <p className="mt-1 text-muted-foreground">{t(`mode.${outcome.mode}`)}</p>
            {outcome.filled.length > 0 && <p className="mt-1 text-muted-foreground">{t('filled', { fields: outcome.filled.map(fieldLabel).join(', ') })}</p>}
            {outcome.conflicts.length > 0 && (
              <div className="mt-2">
                <p className="font-medium text-warning">{t('conflicts')}</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {outcome.conflicts.map((c) => (
                    <li key={c.field}>
                      {fieldLabel(c.field)}: <span className="line-through opacity-70">{c.saved ?? t('empty')}</span> → {c.submitted ?? t('empty')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {outcome.autoIssue && <p className="mt-2 font-medium">{t(`auto.${outcome.autoIssue}`)}</p>}
            {outcome.autoIssueError && <p className="mt-1 text-xs text-destructive">{outcome.autoIssueError}</p>}
            <button type="button" className={`${buttonClass.ghost} mt-2 -ml-3`} onClick={() => setOpen(true)}>
              <UserPen className="h-4 w-4" />
              {t('askAgain')}
            </button>
          </div>
        </div>
        {dialog}
      </div>
    );
  }

  if (token) {
    return (
      <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
        <div className="flex flex-wrap items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('waitingTitle')}</p>
            <p className="mt-1 text-muted-foreground">
              {email ? t('waitingEmail', { email }) : t('waitingLink')} {autoIssue ? t('waitingAuto') : t('waitingManual')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => copy(linkOf(token))}>
              <Copy className="h-4 w-4" />
              {t('copyLink')}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(true)}>
              <Send className="h-4 w-4" />
              {t('resend')}
            </button>
            <button type="button" className={buttonClass.ghost} disabled={pending} onClick={cancel}>
              <X className="h-4 w-4" />
              {t('cancel')}
            </button>
          </div>
        </div>
        {dialog}
      </div>
    );
  }

  return (
    <>
      <button type="button" className={`${buttonClass.secondary} mt-3`} onClick={() => setOpen(true)}>
        <UserPen className="h-4 w-4" />
        {t('button')}
      </button>
      {dialog}
    </>
  );
}
