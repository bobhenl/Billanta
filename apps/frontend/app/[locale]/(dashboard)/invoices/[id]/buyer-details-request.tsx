'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Clock, Copy, Link2, LockKeyhole, Send, UserPen, UserSearch, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass, Modal } from '@/components/modal';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import type { BuyerDetailsOutcome } from '@/lib/invoice-ui';
import { cancelBuyerDetails, requestBuyerDetails, resolveBuyerDetailsPending } from '../actions';
import { createContact } from '../../contacts/actions';
import { ConfidentialText } from '@/components/vault/confidential-text';
import { useVault } from '@/components/vault/vault-provider';
import { sealContact } from '@/lib/vault/contacts';
import { copyText } from '@/lib/clipboard';

type Field = 'email' | 'phone' | 'ico' | 'dic';
const FIELDS: Field[] = ['email', 'phone', 'ico', 'dic'];

interface Props {
  id: string;
  token: string | null;
  submittedAt: string | null;
  submittedLabel: string | null;
  email: string | null;
  autoIssue: boolean;
  outcome: BuyerDetailsOutcome | null;
  contactEmail: string | null;
  /** Required fields of the open link (or the company default for a new one). */
  required: Field[];
  /** The company default, for "use as default". */
  defaultRequired: Field[];
  /** `inline`: inside the "fill in the required details" box of a draft without a customer. */
  variant?: 'block' | 'inline';
  /** The inline variant is shown elsewhere on the page, so skip the start button here. */
  hideStart?: boolean;
}

const sameSet = (a: Field[], b: Field[]) => a.length === b.length && a.every((f) => b.includes(f));

/**
 * "Odběratel si doplní údaje sám" on a draft: send the customer a link to
 * fill in their own billing details, see whether they did, and what
 * happened with the contact.
 */
export function BuyerDetailsRequest({
  id,
  token,
  submittedAt,
  submittedLabel,
  email,
  autoIssue,
  outcome,
  contactEmail,
  required,
  defaultRequired,
  variant = 'block',
  hideStart = false
}: Props) {
  const t = useTranslations('invoices.buyerDetails');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(email ?? contactEmail ?? '');
  const [auto, setAuto] = useState(autoIssue);
  const [fields, setFields] = useState<Field[]>(required);
  const [saveDefault, setSaveDefault] = useState(false);
  // When copying fails even with the HTTP fallback (copyText), the link is shown to copy by hand.
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { requestUnlock } = useVault();

  // Důvěrný režim, contacts: the server can't encrypt for the company, so this browser makes the contact.
  const sealPending = () =>
    startTransition(async () => {
      const p = outcome?.pending;
      if (!p) return;
      const key = await requestUnlock();
      if (!key) return;
      const sealed = await sealContact(
        key,
        {
          legalName: p.legalName,
          ico: p.ico,
          dic: p.dic,
          email: p.email,
          phone: p.phone,
          addressStreet: p.addressStreet,
          addressCity: p.addressCity,
          addressPostalCode: p.addressPostalCode,
          addressCountry: p.addressCountry,
          isPerson: p.isPerson
        },
        { email: false }
      );
      const made = await createContact(Object.fromEntries(Object.entries(sealed).filter(([, v]) => v !== null)));
      if (!made.ok || !made.data) {
        toast({ text: `${t('failed')}: ${made.ok ? 'contact_missing' : made.error}`, tone: 'err' });
        return;
      }
      const attached = await resolveBuyerDetailsPending(id, made.data.id);
      if (!attached.ok) {
        toast({ text: `${t('failed')}: ${attached.error}`, tone: 'err' });
        return;
      }
      toast({ text: t('pendingSeal.done'), tone: 'ok' });
      router.refresh();
    });

  const linkOf = (tok: string) => `${window.location.origin}/d/${tok}`;
  const copy = async (url: string) => {
    try {
      await copyText(url);
      setManualUrl(null);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      setManualUrl(url);
      toast({ text: t('copyManual'), tone: 'info' });
    }
  };

  const toggle = (f: Field) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : FIELDS.filter((x) => x === f || cur.includes(x))));

  const send = () =>
    startTransition(async () => {
      const r = await requestBuyerDetails(id, to, auto, fields, saveDefault && !sameSet(fields, defaultRequired));
      if (!r.ok) {
        toast({ text: `${t('failed')}: ${r.error}`, tone: 'err' });
        return;
      }
      setOpen(false);
      if (r.data.emailed) toast({ text: t('emailed', { email: to.trim() }), tone: 'ok' });
      else await copy(linkOf(r.data.link ?? r.data.token));
      router.refresh();
    });

  const cancel = () =>
    startTransition(async () => {
      const r = await cancelBuyerDetails(id);
      if (!r.ok) toast({ text: `${t('failed')}: ${r.error}`, tone: 'err' });
      else {
        setManualUrl(null);
        toast({ text: t('cancelled'), tone: 'ok' });
        router.refresh();
      }
    });

  const fieldLabel = (f: string) => (['legalName', 'email', 'phone', 'ico', 'dic', 'address', 'isPerson', 'contactId'].includes(f) ? t(`field.${f}`) : f);

  const manual = manualUrl && (
    <label className="mt-3 block text-xs">
      <span className="mb-1 block text-muted-foreground">{t('copyManualLabel')}</span>
      <input
        className={`${inputClass} font-mono text-xs`}
        readOnly
        value={manualUrl}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
      />
    </label>
  );

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
            {to.trim() ? <Send className="h-4 w-4" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            {to.trim() ? t('sendEmail') : t('createLink')}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{t('dialogHint')}</p>
      <label className="mt-4 block text-sm">
        <InfoHint hint={t('emailHint')} className="mb-1">
          <span className="font-medium">{t('emailLabel')}</span>
        </InfoHint>
        <input className={inputClass} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('emailPlaceholder')} maxLength={200} />
      </label>
      <fieldset className="mt-4 text-sm">
        <legend className="mb-2 font-medium">
          <InfoHint hint={t('requiredHint')}>
            <span>{t('requiredLabel')}</span>
          </InfoHint>
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {FIELDS.map((f) => (
            <label key={f} className="inline-flex items-center gap-2">
              <input type="checkbox" checked={fields.includes(f)} onChange={() => toggle(f)} />
              {t(`field.${f}`)}
            </label>
          ))}
        </div>
        {!sameSet(fields, defaultRequired) && (
          <label className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
            {t('requiredSaveDefault')}
          </label>
        )}
      </fieldset>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <InfoHint hint={t('autoIssueHint')}>
          <span className="font-medium">{t('autoIssue')}</span>
        </InfoHint>
      </label>
      {token && !submittedAt && <p className="mt-4 text-xs text-warning">{t('replaceNote')}</p>}
    </Modal>
  );

  if (variant === 'inline') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass.secondary} onClick={() => setOpen(true)}>
          <UserPen className="h-4 w-4" aria-hidden="true" />
          {t('button')}
        </button>
        <Link href={`/invoices/${id}/edit`} className={buttonClass.ghost}>
          <UserSearch className="h-4 w-4" aria-hidden="true" />
          {t('pickCustomer')}
        </Link>
        {manual && <div className="w-full">{manual}</div>}
        {dialog}
      </div>
    );
  }

  if (submittedAt && outcome) {
    return (
      <div className="mt-4 rounded-xl border border-success/40 bg-success/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('submittedTitle', { date: submittedLabel ?? '' })}</p>
            <p className="mt-1 text-muted-foreground">{t(`mode.${outcome.mode}`)}</p>
            {outcome.mode === 'pending_seal' && outcome.pending && (
              <div className="mt-2 rounded-lg bg-muted/50 p-3">
                <p className="font-medium">
                  {outcome.pending.legalName}
                  {outcome.pending.ico && <span className="text-muted-foreground"> · IČO {outcome.pending.ico}</span>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('pendingSeal.hint')}</p>
                <button type="button" className={`${buttonClass.primary} mt-2`} disabled={pending} onClick={sealPending}>
                  <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                  {t('pendingSeal.button')}
                </button>
              </div>
            )}
            {outcome.filled.length > 0 && <p className="mt-1 text-muted-foreground">{t('filled', { fields: outcome.filled.map(fieldLabel).join(', ') })}</p>}
            {outcome.conflicts.length > 0 && (
              <div className="mt-2">
                <p className="font-medium text-warning">{t('conflicts')}</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {outcome.conflicts.map((c) => (
                    <li key={c.field}>
                      {fieldLabel(c.field)}: <span className="line-through opacity-70">{c.saved ? <ConfidentialText value={c.saved} compact /> : t('empty')}</span> → {c.submitted ?? t('empty')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {outcome.autoIssue && <p className="mt-2 font-medium">{t(`auto.${outcome.autoIssue}`)}</p>}
            {outcome.autoIssueError && <p className="mt-1 text-xs text-destructive">{outcome.autoIssueError}</p>}
            <button type="button" className={`${buttonClass.ghost} mt-2 -ml-3`} onClick={() => setOpen(true)}>
              <UserPen className="h-4 w-4" aria-hidden="true" />
              {t('askAgain')}
            </button>
            {manual}
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
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('waitingTitle')}</p>
            <p className="mt-1 text-muted-foreground">
              {email ? t('waitingEmail', { email }) : t('waitingLink')} {autoIssue ? t('waitingAuto') : t('waitingManual')}
            </p>
            {required.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('requiredSummary', { fields: required.map(fieldLabel).join(', ') })}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => copy(linkOf(token))}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              {t('copyLink')}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(true)}>
              <Send className="h-4 w-4" aria-hidden="true" />
              {t('resend')}
            </button>
            <button type="button" className={buttonClass.ghost} disabled={pending} onClick={cancel}>
              <X className="h-4 w-4" aria-hidden="true" />
              {t('cancel')}
            </button>
          </div>
        </div>
        {manual}
        {dialog}
      </div>
    );
  }

  if (hideStart) return null;
  return (
    <>
      <button type="button" className={`${buttonClass.secondary} mt-3`} onClick={() => setOpen(true)}>
        <UserPen className="h-4 w-4" aria-hidden="true" />
        {t('button')}
      </button>
      {manual}
      {dialog}
    </>
  );
}
