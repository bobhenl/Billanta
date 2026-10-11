'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { respondToQuote } from '@/lib/public-quote-actions';

interface QuoteResponseProps {
  token: string;
  preview: boolean;
  state: { canRespond: boolean; response: 'accepted' | 'rejected' | null; respondedAt: string | null; name: string | null };
  respondedAtLabel: string | null;
}

/** Accept / reject box for a quote in the client portal (Invoice Ninja's quote approval). */
export function QuoteResponse({ token, preview, state, respondedAtLabel }: QuoteResponseProps) {
  const t = useTranslations('publicInvoice.quote');
  const router = useRouter();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (state.response) {
    const accepted = state.response === 'accepted';
    const Icon = accepted ? CheckCircle2 : XCircle;
    return (
      <div className={`mt-8 flex items-start gap-3 rounded-lg border p-5 ${accepted ? 'border-success/40 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${accepted ? 'text-success' : 'text-destructive'}`} />
        <div className="text-sm">
          <p className="font-semibold">{accepted ? t('acceptedTitle') : t('rejectedTitle')}</p>
          <p className="mt-1 text-muted-foreground">
            {t('answeredBy', { name: state.name ?? '–', date: respondedAtLabel ?? '' })}
          </p>
        </div>
      </div>
    );
  }
  if (!state.canRespond) return null;

  const submit = (response: 'accepted' | 'rejected') => {
    setError(null);
    if (!name.trim()) {
      setError(t('errors.name'));
      return;
    }
    if (response === 'rejected' && !window.confirm(t('confirmReject'))) return;
    startTransition(async () => {
      const r = await respondToQuote(token, response, name, note);
      if (r.ok) router.refresh();
      else setError(t(`errors.${r.error}`));
    });
  };

  return (
    <div className="mt-8 rounded-lg border border-primary/30 bg-primary/5 p-5">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('hint')}</p>
      {preview && <p className="mt-2 text-xs font-medium text-warning">{t('previewNote')}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t('nameLabel')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoComplete="name"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">{t('noteLabel')}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || preview}
          onClick={() => submit('accepted')}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          {t('accept')}
        </button>
        <button
          type="button"
          disabled={pending || preview}
          onClick={() => submit('rejected')}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <XCircle className="h-4 w-4" />
          {t('reject')}
        </button>
      </div>
    </div>
  );
}
