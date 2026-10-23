'use client';

import { useState, useTransition } from 'react';
import { FilePlus2, Loader2, Pencil, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import type { Contact } from '../../invoices/new/types';
import { deleteContact, lookupAres, setContactStarred, updateContact } from '../actions';
import { ContactEditor } from '../contact-editor';

/** Header actions on the contact detail: invoice, star, ARES refresh, edit, delete. */
export function ContactActions({ contact }: { contact: Contact }) {
  const t = useTranslations('contacts.detail');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const canEdit = useCanWrite('contacts');
  const canInvoice = useCanWrite('invoices');

  // Edit is icon-only on phones too, so all actions fit one row at 375px.
  const pill = cn(buttonClass.secondary, 'h-10 w-10 shrink-0 px-0 sm:w-auto sm:px-3.5');
  // The less frequent actions are icons only, so the header stays one row on a phone.
  const icon = cn(buttonClass.secondary, 'h-10 w-10 shrink-0 px-0');

  const star = () =>
    startTransition(async () => {
      const stored = await setContactStarred(contact.id, !contact.isStarred);
      if (stored === null) toast({ text: t('actionFailed'), tone: 'err' });
      router.refresh();
    });

  const refreshAres = () =>
    startTransition(async () => {
      if (!contact.ico) return;
      const ares = await lookupAres(contact.ico);
      if (!ares.ok) {
        toast({ text: ares.error === 'not_found' ? t('aresNotFound') : `${t('actionFailed')}: ${ares.error}`, tone: 'err' });
        return;
      }
      const { ico: _ico, ...fields } = ares.data;
      const saved = await updateContact(contact.id, { ...fields, aresVerified: true });
      toast(saved.ok ? { text: t('aresUpdated'), tone: 'ok' } : { text: `${t('actionFailed')}: ${saved.error}`, tone: 'err' });
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteContact(contact.id);
      if (!result.ok) {
        toast({ text: result.error === 'contact_in_use' ? t('inUse') : `${t('actionFailed')}: ${result.error}`, tone: 'err' });
        setConfirmDelete(false);
        return;
      }
      toast({ text: t('deleted'), tone: 'ok' });
      router.push('/contacts');
    });

  if (!canEdit && !canInvoice) return null;

  return (
    // Tighter on a phone so the invoice button and the four icons share one row.
    <div className="flex flex-wrap gap-1.5 sm:gap-2">
      {canInvoice && (
      <Link
        href={`/invoices/new?contact=${contact.id}`}
        className={cn(buttonClass.primary, 'h-10 px-3 sm:px-4')}
      >
        <FilePlus2 className="h-4 w-4" />
        {t('newInvoice')}
      </Link>
      )}
      {canEdit && (
      <>
      <button type="button" className={pill} onClick={() => setEditing(true)} aria-label={t('edit')} title={t('edit')}>
        <Pencil className="h-4 w-4" />
        <span className="hidden sm:inline">{t('edit')}</span>
      </button>
      <button
        type="button"
        className={icon}
        onClick={star}
        disabled={pending}
        aria-pressed={contact.isStarred}
        aria-label={contact.isStarred ? t('unstar') : t('star')}
        title={contact.isStarred ? t('unstar') : t('star')}
      >
        <Star className={cn('h-4 w-4', contact.isStarred && 'fill-warning text-warning')} />
      </button>
      {/* ARES is the Czech register; other contacts have nothing to refresh from there. */}
      {contact.ico && (contact.addressCountry || 'CZ') === 'CZ' && (
        <button type="button" className={icon} onClick={refreshAres} disabled={pending} aria-label={t('refreshAres')} title={t('refreshAres')}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        className={cn(icon, 'text-destructive hover:text-destructive')}
        onClick={() => setConfirmDelete(true)}
        aria-label={t('delete')}
        title={t('delete')}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      </>
      )}

      {canEdit && editing && (
        <ContactEditor
          open
          contact={contact}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('deleteTitle')}
        footer={
          <>
            <button type="button" className={cn(buttonClass.secondary, 'h-10')} onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </button>
            <button type="button" className={cn(buttonClass.danger, 'h-10')} onClick={remove} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('delete')}
            </button>
          </>
        }
      >
        {t('deleteBody', { name: contact.legalName })}
      </Modal>
    </div>
  );
}
