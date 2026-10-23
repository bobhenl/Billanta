'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { NotebookPen } from 'lucide-react';
import { InfoHint } from '@/components/info-hint';
import { inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/**
 * The payer's own note on the invoice ("schváleno, platit do pátku"). Kept only
 * in this browser – the supplier never sees it and nothing is sent anywhere.
 */
export function PayerNote({ token }: { token: string }) {
  const t = useTranslations('publicInvoice.payerNote');
  const key = `billanta.payerNote.${token}`;
  const id = useId();
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setNote(localStorage.getItem(key) ?? '');
    } catch {
      /* storage blocked – the box still works for this visit */
    }
  }, [key]);

  const change = (value: string) => {
    setNote(value);
    try {
      if (value.trim()) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };

  // A rarely used extra: one quiet link until the payer opens it or already has a note.
  if (!open && !note) {
    return (
      <div className="mt-6 print:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary hover:underline"
        >
          <NotebookPen className="h-4 w-4" />
          {t('add')}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 print:hidden">
      <InfoHint hint={t('hint')} rowClassName="text-sm font-semibold">
        <label htmlFor={id} className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-muted-foreground" />
          {t('title')}
        </label>
      </InfoHint>
      <textarea
        id={id}
        className={cn(inputClass, 'mt-2 min-h-[72px]')}
        value={note}
        maxLength={2000}
        placeholder={t('placeholder')}
        autoFocus={open}
        onChange={(e) => change(e.target.value)}
      />
      {saved && <p className="mt-1 text-xs text-muted-foreground">{t('saved')}</p>}
    </div>
  );
}
