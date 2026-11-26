'use client';

import { useState, useTransition } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { PasswordInput } from '@/components/password-input';
import { toast } from '@/components/toaster';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { relockInvoices, setInvoiceLock, unlockInvoices } from '../actions';

const KNOWN = ['wrong_current', 'reauth_required', 'too_many_attempts'];

/** Shown instead of a locked invoice: the viewer's own password opens it for a while. */
export function UnlockInvoice() {
  const t = useTranslations('doc.lock');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await unlockInvoices(password);
      if (!res.ok) {
        setError(KNOWN.includes(res.error) ? t(`errors.${res.error}`) : t('errors.generic'));
        return;
      }
      setPassword('');
      router.refresh();
    });
  }

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-xl border border-border bg-card p-6 text-center">
      <Lock className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      <form onSubmit={submit} className="mt-4 space-y-3 text-left">
        <PasswordInput
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder={t('password')}
          aria-label={t('password')}
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={pending} className={cn(buttonClass.primary, 'w-full')}>
          {t('open')}
        </button>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">{t('note')}</p>
    </div>
  );
}

/** Lock state on an open invoice; the toggle is for owners and admins. */
export function InvoiceLockBar({ id, locked, canLock }: { id: string; locked: boolean; canLock: boolean }) {
  const t = useTranslations('doc.lock');
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!locked && !canLock) return null;

  function toggle() {
    start(async () => {
      const res = await setInvoiceLock(id, !locked);
      if (!res.ok) {
        toast({ text: t('errors.generic'), tone: 'err' });
        return;
      }
      toast({ text: locked ? t('unlockedToast') : t('lockedToast'), tone: 'ok' });
      router.refresh();
    });
  }

  function relock() {
    start(async () => {
      await relockInvoices();
      router.refresh();
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      {locked && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          {t('badge')}
        </span>
      )}
      {canLock && (
        <button type="button" onClick={toggle} disabled={pending} className={cn(buttonClass.secondary, 'h-8 px-3 text-xs')} title={locked ? undefined : t('lockHint')}>
          {locked ? <LockOpen className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
          {locked ? t('unlock') : t('lock')}
        </button>
      )}
      {locked && (
        <button type="button" onClick={relock} disabled={pending} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          {t('relock')}
        </button>
      )}
    </div>
  );
}
