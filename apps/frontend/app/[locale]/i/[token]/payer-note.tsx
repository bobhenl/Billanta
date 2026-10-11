'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { NotebookPen } from 'lucide-react';

/**
 * The payer's own note on the invoice ("schváleno, platit do pátku"). Kept only
 * in this browser — the supplier never sees it and nothing is sent anywhere.
 */
export function PayerNote({ token }: { token: string }) {
  const t = useTranslations('publicInvoice.payerNote');
  const key = `billanta.payerNote.${token}`;
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      setNote(localStorage.getItem(key) ?? '');
    } catch {
      /* storage blocked — the box still works for this visit */
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

  return (
    <div className="mt-8 rounded-lg border border-border p-5 print:hidden">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <NotebookPen className="h-4 w-4 text-muted-foreground" />
        {t('title')}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
      <textarea
        className="mt-3 min-h-[80px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
        value={note}
        maxLength={2000}
        placeholder={t('placeholder')}
        onChange={(e) => change(e.target.value)}
      />
      {saved && <p className="mt-1 text-xs text-muted-foreground">{t('saved')}</p>}
    </div>
  );
}
