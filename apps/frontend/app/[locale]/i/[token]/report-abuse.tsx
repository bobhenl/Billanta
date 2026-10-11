'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Flag, CheckCircle2 } from 'lucide-react';
import { reportInvoice, type AbuseReason } from '@/lib/public-report-actions';

const REASONS: AbuseReason[] = ['fraud', 'not_ordered', 'spam', 'other'];

/**
 * "I didn't expect this document" link for recipients. Reports go to the
 * service operator, not to the issuing company; several independent reports
 * pause the company's e-mail sending until it is reviewed.
 */
export function ReportAbuse({ token, initiallyOpen }: { token: string; initiallyOpen: boolean }) {
  const t = useTranslations('publicInvoice.report');
  const [open, setOpen] = useState(initiallyOpen);
  const [reason, setReason] = useState<AbuseReason>('not_ordered');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none';

  if (done) {
    return (
      <div className="mt-8 flex items-start gap-3 rounded-lg border border-border p-5 text-sm print:hidden">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div>
          <p className="font-semibold">{t('doneTitle')}</p>
          <p className="mt-1 text-muted-foreground">{t('doneBody')}</p>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-8 text-center print:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Flag className="h-3.5 w-3.5" />
          {t('link')}
        </button>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await reportInvoice(token, reason, message, email);
      if (res.ok) setDone(true);
      else setError(t(`errors.${res.error}`));
    });
  };

  return (
    <form id="report" onSubmit={submit} className="mt-8 space-y-3 rounded-lg border border-border p-5 print:hidden">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Flag className="h-4 w-4 text-muted-foreground" />
        {t('title')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t('reason')}</span>
        <select value={reason} onChange={(e) => setReason(e.target.value as AbuseReason)} className={field}>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reasons.${r}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t('message')}</span>
        <textarea value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} className={`${field} min-h-[80px]`} placeholder={t('messagePlaceholder')} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t('email')}</span>
        <input type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} className={field} placeholder={t('emailPlaceholder')} />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60">
          {pending ? t('sending') : t('submit')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm">
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
