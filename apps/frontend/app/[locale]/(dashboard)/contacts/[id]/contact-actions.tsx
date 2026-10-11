'use client';

import { useState, useTransition } from 'react';
import { FilePlus2, Loader2, Pencil, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { buttonClass, Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
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

  const pill = 'inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary disabled:opacity-50';

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

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={`/invoices/new?contact=${contact.id}`}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
      >
        <FilePlus2 className="h-4 w-4" />
        {t('newInvoice')}
      </Link>
      <button type="button" className={pill} onClick={star} disabled={pending}>
        <Star className={cn('h-4 w-4', contact.isStarred && 'fill-warning text-warning')} />
        {contact.isStarred ? t('unstar') : t('star')}
      </button>
      {contact.ico && (
        <button type="button" className={pill} onClick={refreshAres} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t('refreshAres')}
        </button>
      )}
      <button type="button" className={pill} onClick={() => setEditing(true)}>
        <Pencil className="h-4 w-4" />
        {t('edit')}
      </button>
      <button type="button" className={cn(pill, 'text-destructive hover:text-destructive')} onClick={() => setConfirmDelete(true)}>
        <Trash2 className="h-4 w-4" />
        {t('delete')}
      </button>

      {editing && (
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
            <button type="button" className={buttonClass.secondary} onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </button>
            <button type="button" className={buttonClass.danger} onClick={remove} disabled={pending}>
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
